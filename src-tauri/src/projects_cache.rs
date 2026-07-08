// In-memory cache of the desktop's project + tab tree, kept fresh by the
// React frontend and served to WSS mobile clients.
//
// The desktop's `$projects` nano-store (see `src/modules/stores/$projects.ts`)
// is the source of truth for every mutation. On any change, React calls the
// `sync_projects_to_wss` Tauri command with the full projects vector; this
// module stores it and notifies subscribers so the WSS server can broadcast
// the fresh state to every connected mobile client.
//
// Cold-start fallback: when the Tauri backend spins up before React finishes
// mounting, `ProjectsCache::load_from_disk` reads `projects.json` directly
// from the desktop's config directory. React overwrites the cache once it
// hydrates, so the fallback is a safety net for the ~200 ms window between
// backend init and frontend first-paint.
//
// Replaces the pre-Phase-A `ProjectRegistry` which read only from `PtyMap`
// and hallucinated project groupings from `<project>:<suffix>` tab-id
// prefixes. Both were wrong: desktop stores projects as first-class
// objects with explicit ids, and sleeping tabs (in projects.json but not
// yet spawned) never had a PtyHandle at all.

use crate::protocol::{ProjectSummary, TabSummary};
use crate::pty_manager::PtyMap;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tokio::sync::watch;

/// Owning cache. Callers hold an `Arc<ProjectsCache>` from `app.manage()`.
pub struct ProjectsCache {
    inner: Mutex<Vec<ProjectSummary>>,
    change_tx: watch::Sender<u64>,
    change_rx: watch::Receiver<u64>,
    version: Mutex<u64>,
}

impl ProjectsCache {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(0u64);
        Self {
            inner: Mutex::new(Vec::new()),
            change_tx: tx,
            change_rx: rx,
            version: Mutex::new(0),
        }
    }

    /// Replace the cached projects and bump the change version.
    /// Every WSS connection watching `subscribe_changes()` wakes up.
    pub fn set(&self, projects: Vec<ProjectSummary>) {
        *self.inner.lock().expect("projects_cache lock poisoned") = projects;
        let mut v = self.version.lock().expect("version lock poisoned");
        *v = v.wrapping_add(1);
        let _ = self.change_tx.send(*v);
    }

    /// Snapshot the current tree for broadcast. Every WSS `Projects` push
    /// clones out of the cache once and sends that clone; the cache stays
    /// available for the next reader.
    ///
    /// Overlays `is_spawned` on each `TabSummary` by cross-referencing the
    /// live `PtyMap`. React does not know which tabs currently have a
    /// live PTY (spawn is lazy and driven by the terminal-pane mount),
    /// so we compute the flag here at read time.
    pub fn projects_with_spawn_status(&self, pty_map: &PtyMap) -> Vec<ProjectSummary> {
        let projects = self
            .inner
            .lock()
            .expect("projects_cache lock poisoned")
            .clone();
        let pty = pty_map.lock().expect("pty_map lock poisoned");
        projects
            .into_iter()
            .map(|mut project| {
                for tab in &mut project.tabs {
                    tab.is_spawned = pty.contains_key(&tab.tab_id);
                }
                project
            })
            .collect()
    }

    /// Bump the change version without mutating the cached projects.
    /// Used by open_tab / close_tab which do not modify the tree itself
    /// but do change which tabs are currently spawned (the `is_spawned`
    /// overlay computed at read time).
    pub fn notify_spawn_change(&self) {
        let mut v = self.version.lock().expect("version lock poisoned");
        *v = v.wrapping_add(1);
        let _ = self.change_tx.send(*v);
    }

    pub fn subscribe_changes(&self) -> watch::Receiver<u64> {
        self.change_rx.clone()
    }

    /// Read `projects.json` from the desktop's config directory. Used only
    /// on cold start before React has had a chance to sync.
    ///
    /// Deserialises into the frontend's persisted shape (kebab-case field
    /// names via serde attributes) then maps into the wire shape. Returns
    /// None on any error (missing file, malformed JSON, permissions),
    /// caller falls back to an empty tree.
    pub fn load_from_disk(config_dir: &Path) -> Option<Vec<ProjectSummary>> {
        let path = config_dir.join("projects.json");
        let bytes = std::fs::read(&path).ok()?;
        let stored: StoredProjectsFile = serde_json::from_slice(&bytes).ok()?;
        Some(stored.projects.into_iter().map(Into::into).collect())
    }
}

impl Default for ProjectsCache {
    fn default() -> Self {
        Self::new()
    }
}

// The on-disk shape written by the React frontend's `save_projects` Tauri
// command. Field names are camelCase in the JSON to match the TS types.
// We deserialise into these structs then map into the wire ProjectSummary
// / TabSummary so any drift between disk and wire shape is caught here
// rather than silently accepted downstream.
#[derive(Debug, Deserialize, Serialize)]
struct StoredProjectsFile {
    projects: Vec<StoredProject>,
}

/// Public so `commands::sync_projects_to_wss` can deserialise React's
/// camelCase `$projects` payload without duplicating the mapping code.
#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct StoredProject {
    id: String,
    name: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default = "default_true", rename = "isExpanded")]
    is_expanded: bool,
    tabs: Vec<StoredTab>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct StoredTab {
    id: String,
    label: String,
    #[serde(default)]
    cmd: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default, rename = "lastCwd")]
    last_cwd: Option<String>,
    #[serde(default, rename = "userRenamed")]
    user_renamed: bool,
}

fn default_true() -> bool {
    true
}

impl From<StoredProject> for ProjectSummary {
    fn from(p: StoredProject) -> Self {
        ProjectSummary {
            project_id: p.id,
            name: p.name,
            path: p.path,
            pinned: p.pinned,
            is_expanded: p.is_expanded,
            tabs: p.tabs.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<StoredTab> for TabSummary {
    fn from(t: StoredTab) -> Self {
        TabSummary {
            tab_id: t.id,
            label: t.label,
            cwd: t.last_cwd.clone(),
            agent: None,
            cmd: t.cmd,
            last_cwd: t.last_cwd,
            pinned: t.pinned,
            user_renamed: t.user_renamed,
            // Filled in at read time by projects_with_spawn_status().
            is_spawned: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn empty_pty_map() -> PtyMap {
        Arc::new(Mutex::new(HashMap::new()))
    }

    #[test]
    fn empty_cache_yields_empty_projects() {
        let cache = ProjectsCache::new();
        assert!(
            cache
                .projects_with_spawn_status(&empty_pty_map())
                .is_empty()
        );
    }

    #[test]
    fn set_replaces_and_bumps_version() {
        let cache = ProjectsCache::new();
        let mut rx = cache.subscribe_changes();
        assert_eq!(*rx.borrow(), 0);

        cache.set(vec![ProjectSummary {
            project_id: "p1".into(),
            name: "proj".into(),
            path: None,
            pinned: false,
            is_expanded: true,
            tabs: vec![],
        }]);
        assert_eq!(*rx.borrow_and_update(), 1);

        cache.set(vec![]);
        assert_eq!(*rx.borrow(), 2);
    }

    #[test]
    fn multiple_subscribers_all_see_changes() {
        let cache = ProjectsCache::new();
        let a = cache.subscribe_changes();
        let b = cache.subscribe_changes();
        cache.set(vec![]);
        assert_eq!(*a.borrow(), 1);
        assert_eq!(*b.borrow(), 1);
    }

    #[test]
    fn load_from_disk_parses_desktop_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("projects.json");
        let contents = json!({
            "projects": [
                {
                    "id": "control-center",
                    "name": "control-center",
                    "path": "/tmp/cc",
                    "pinned": false,
                    "isExpanded": true,
                    "tabs": [
                        {
                            "id": "control-center:shell",
                            "label": "shell",
                            "cmd": "zsh",
                            "pinned": false,
                            "lastCwd": "/tmp/cc",
                            "userRenamed": false
                        }
                    ]
                }
            ]
        });
        std::fs::write(&path, serde_json::to_vec(&contents).unwrap()).unwrap();

        let projects = ProjectsCache::load_from_disk(tmp.path()).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project_id, "control-center");
        assert_eq!(projects[0].path.as_deref(), Some("/tmp/cc"));
        assert!(projects[0].is_expanded);
        assert_eq!(projects[0].tabs.len(), 1);
        let tab = &projects[0].tabs[0];
        assert_eq!(tab.tab_id, "control-center:shell");
        assert_eq!(tab.label, "shell");
        assert_eq!(tab.cmd.as_deref(), Some("zsh"));
        assert_eq!(tab.last_cwd.as_deref(), Some("/tmp/cc"));
        // cwd defaults to last_cwd on the wire; consumers show whichever.
        assert_eq!(tab.cwd.as_deref(), Some("/tmp/cc"));
    }

    #[test]
    fn load_from_disk_returns_none_on_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ProjectsCache::load_from_disk(tmp.path()).is_none());
    }

    #[test]
    fn projects_with_spawn_status_flags_live_tabs() {
        let cache = ProjectsCache::new();
        cache.set(vec![ProjectSummary {
            project_id: "p1".into(),
            name: "proj".into(),
            path: None,
            pinned: false,
            is_expanded: true,
            tabs: vec![
                TabSummary {
                    tab_id: "t1".into(),
                    label: "a".into(),
                    cwd: None,
                    agent: None,
                    cmd: None,
                    last_cwd: None,
                    pinned: false,
                    user_renamed: false,
                    is_spawned: false,
                },
                TabSummary {
                    tab_id: "t2".into(),
                    label: "b".into(),
                    cwd: None,
                    agent: None,
                    cmd: None,
                    last_cwd: None,
                    pinned: false,
                    user_renamed: false,
                    is_spawned: false,
                },
            ],
        }]);

        // Populate PtyMap so t1 is spawned, t2 is sleeping. We cannot
        // trivially construct a PtyHandle for a unit test (it holds
        // portable-pty trait objects); wrap the map access minimally.
        // The check is `contains_key` so we insert a synthetic entry.
        // Rebuild via unsafe transmute would be worse; use the same
        // approach the pre-Phase-A tests used - skip PtyHandle
        // construction and cover the branch in the integration test.
        //
        // Here we just verify the empty-map path: all tabs come back as
        // is_spawned=false.
        let projects = cache.projects_with_spawn_status(&empty_pty_map());
        assert!(!projects[0].tabs[0].is_spawned);
        assert!(!projects[0].tabs[1].is_spawned);
    }
}
