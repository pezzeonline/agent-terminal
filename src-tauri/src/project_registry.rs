// Read view over the desktop's tab inventory, packaged as
// `ServerFrame::Projects.data`.
//
// The WSS server pushes a full Projects frame to each client on auth-ok
// and again on every notify_change() fire. Change events come from the
// existing tab-lifecycle sites (`commands::open_tab`, `commands::close_
// tab`, `pty_manager::respawn_in_place`) once they're wired up in a
// later commit.
//
// Grouping: tab ids follow the convention `<project>:<suffix>` (used
// throughout the desktop UI). Ids without a colon land under a synthetic
// "Ungrouped" project so mobile clients always see everything.
//
// Metadata (agent name, git branch, ports) stays intentionally sparse for
// Phase 1 — the wire types carry the fields but Phase 3's status-pill
// work populates them. cwd is available now via mod_engine's CwdTable.

use crate::mod_engine::CwdTable;
use crate::protocol::{ProjectSummary, TabSummary};
use crate::pty_manager::PtyMap;
use std::sync::Arc;
use tokio::sync::watch;

/// Bundle of read handles + a change-notification watch. The registry
/// itself owns nothing PTY-side; every call goes back to the source of
/// truth (`PtyMap`, `CwdTable`).
pub struct ProjectRegistry {
    pty_map: PtyMap,
    cwd_table: CwdTable,
    change_tx: watch::Sender<u64>,
    change_rx: watch::Receiver<u64>,
}

impl ProjectRegistry {
    pub fn new(pty_map: PtyMap, cwd_table: CwdTable) -> Self {
        // Initial "version" of 0. Every notify_change bumps it so the
        // watch fires even if consumers get spurious wakeups.
        let (tx, rx) = watch::channel(0u64);
        Self {
            pty_map,
            cwd_table,
            change_tx: tx,
            change_rx: rx,
        }
    }

    /// Build the current project + tab tree. Fresh Vec on every call —
    /// the caller sends it as `ServerFrame::Projects { data }`.
    pub fn projects(&self) -> Vec<ProjectSummary> {
        let cwds = self
            .cwd_table
            .lock()
            .expect("cwd_table lock poisoned")
            .clone();
        let map = self.pty_map.lock().expect("pty_map lock poisoned");

        // Group tabs by project prefix. Order matters for the mobile UI —
        // preserve insertion order (BTreeMap gives alphabetical which is
        // arguably better than the HashMap random order the PtyMap gives).
        let mut groups: std::collections::BTreeMap<String, Vec<TabSummary>> =
            std::collections::BTreeMap::new();

        for tab_id in map.keys() {
            let (project_id, label) = split_tab_id(tab_id);
            let cwd = cwds.get(tab_id).cloned();
            groups.entry(project_id).or_default().push(TabSummary {
                tab_id: tab_id.clone(),
                label,
                cwd,
                // Populated in Phase 3 when the mod engine grows a
                // per-tab agent-summary accessor.
                agent: None,
            });
        }

        groups
            .into_iter()
            .map(|(project_id, tabs)| ProjectSummary {
                name: project_id.clone(),
                project_id,
                tabs,
            })
            .collect()
    }

    /// Signal that the tab inventory has changed. Wakes every watcher
    /// bound via `subscribe_changes`.
    pub fn notify_change(&self) {
        // send_modify updates the value and fires the watch even if the
        // new value equals the old — we increment monotonically so
        // consumers see distinct versions.
        self.change_tx.send_modify(|v| *v = v.saturating_add(1));
    }

    /// Return a fresh watch::Receiver. Each WSS connection holds one and
    /// pushes a Projects frame whenever it fires.
    pub fn subscribe_changes(&self) -> watch::Receiver<u64> {
        self.change_rx.clone()
    }
}

/// Split a tab id into `(project_id, label)`. `foo:bar` becomes
/// `("foo", "bar")`; a plain `foo` becomes `("Ungrouped", "foo")`. The
/// "Ungrouped" fallback matches the master plan's guidance for loose tabs
/// that aren't associated with a workspace.
fn split_tab_id(tab_id: &str) -> (String, String) {
    match tab_id.split_once(':') {
        Some((project, suffix)) => (project.to_string(), suffix.to_string()),
        None => ("Ungrouped".to_string(), tab_id.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty_manager::PtyHandle;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn empty_pty_map() -> PtyMap {
        Arc::new(Mutex::new(HashMap::new()))
    }

    fn empty_cwd_table() -> CwdTable {
        Arc::new(Mutex::new(HashMap::new()))
    }

    /// Insert a synthetic tab id into the PtyMap. Uses a null PtyHandle
    /// via `unsafe {}` transmute? No — simpler: skip actually
    /// constructing PtyHandle (it holds trait objects that need a real
    /// PTY). Test via ProjectRegistry::projects reading from a map
    /// populated *around* PtyHandle: we assert only on keys/CwdTable.
    ///
    /// The `pty_map.lock().keys()` iteration in `projects()` is the only
    /// thing under test — populate a real map with real handles when
    /// pty_manager gains a mockable constructor, or cover via the
    /// wss_integration test at the top of the stack.

    #[test]
    fn empty_map_yields_empty_projects() {
        let reg = ProjectRegistry::new(empty_pty_map(), empty_cwd_table());
        assert!(reg.projects().is_empty());
    }

    #[test]
    fn notify_change_bumps_watch_version() {
        let reg = ProjectRegistry::new(empty_pty_map(), empty_cwd_table());
        let mut rx = reg.subscribe_changes();
        // Baseline value before any notification.
        assert_eq!(*rx.borrow(), 0);
        reg.notify_change();
        // borrow_and_update marks the current value as seen so the next
        // `changed().await` waits for a real update.
        assert_eq!(*rx.borrow_and_update(), 1);
        reg.notify_change();
        reg.notify_change();
        assert_eq!(*rx.borrow(), 3);
    }

    #[test]
    fn multiple_subscribers_all_see_changes() {
        let reg = ProjectRegistry::new(empty_pty_map(), empty_cwd_table());
        let a = reg.subscribe_changes();
        let b = reg.subscribe_changes();
        reg.notify_change();
        assert_eq!(*a.borrow(), 1);
        assert_eq!(*b.borrow(), 1);
    }

    // ---- split_tab_id ----

    #[test]
    fn split_tab_id_colon_form() {
        assert_eq!(
            split_tab_id("claude-ui:dev"),
            ("claude-ui".to_string(), "dev".to_string())
        );
    }

    #[test]
    fn split_tab_id_no_colon_lands_in_ungrouped() {
        assert_eq!(
            split_tab_id("loose-tab"),
            ("Ungrouped".to_string(), "loose-tab".to_string())
        );
    }

    #[test]
    fn split_tab_id_empty_project_side() {
        // ":foo" splits with an empty project. Not a shape we'd expect
        // in practice but the parser handles it gracefully.
        assert_eq!(
            split_tab_id(":foo"),
            ("".to_string(), "foo".to_string())
        );
    }

    // ---- projects() with a populated map ----
    //
    // PtyHandle can't be trivially constructed in a unit test (it holds
    // portable-pty trait objects that need a real openpty). The
    // `projects()` grouping / cwd merge / TabSummary shape are covered
    // end-to-end by the WSS integration test in a later commit. Here we
    // pin the pure-function behaviour (`split_tab_id`) + the change
    // notification mechanism directly.

    // Suppress the unused imports lint for symbols that are only present
    // for the not-yet-wired PtyHandle tests.
    #[allow(dead_code)]
    fn _pty_handle_stub_note() -> PtyHandle {
        unimplemented!("PtyHandle needs a real PTY — covered in integration tests")
    }
}
