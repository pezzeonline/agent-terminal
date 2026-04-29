//! Native OS notification service — fully agent-agnostic.
//!
//! `NotificationService` is the **single owner** of OS notification firing,
//! suppression, permission, and click routing. It exposes a thin opaque
//! `maybe_notify(tab_id, agent_id, state, message)` API that callers (today:
//! `AgentTurnMod`) invoke when an agent transitions state. The service:
//!
//! 1. Detects whether the transition is notification-worthy (state filter +
//!    transition detection — same state twice is a no-op)
//! 2. Applies suppression (master toggle + active-tab/foreground rule)
//! 3. Resolves the human-readable display name from `AGENT_HOOK_CONFIGS`
//! 4. Resolves the project name from a frontend-pushed projects map
//! 5. Splits the composite tab id `<project_id>:<tab_id_within_project>` so
//!    the click handler can route via `navigateToTab(project_id, tab_id)`
//! 6. Calls `tauri-plugin-notification` to actually post the banner
//!
//! ## Agent-agnosticism
//!
//! The service knows nothing about specific agents. It receives an `agent_id`
//! string from the caller and looks up the display name from the registry —
//! the same registry that drives hook installation. Adding a new agent =
//! one entry in `AGENT_HOOK_CONFIGS` + one new mod that calls into here. No
//! changes to this file. The `maybe_notify` call site in `AgentTurnMod` is
//! also agent-agnostic — it forwards `payload.agent` straight through.
//!
//! ## State sync from the frontend
//!
//! The frontend pushes three signals via Tauri commands so suppression can
//! be evaluated entirely in Rust:
//!
//! - `set_projects` — list of `{id, name, tabs[id]}` for project name lookup
//! - `set_active_tab` — composite id of the currently-displayed tab (or null)
//! - `set_app_focus` — whether the agent-terminal window is OS-foreground
//! - `set_notifications_enabled` — master toggle (mirrors localStorage)
//!
//! These signals are best-effort: if any are stale, suppression may
//! over-fire (banner shows when it shouldn't) — never under-fire (silent
//! when it shouldn't be).
//!
//! ## Click routing
//!
//! `routes` keeps a per-tab routing entry with a 5-second TTL. The window
//! focus handler in `lib.rs` reads `take_fresh()` on every focus event and
//! emits `notification:click` if a fresh entry exists. The frontend
//! subscribes and calls `navigateToTab` with the project_id + tab_id we
//! split out of the composite.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::{NotificationExt, PermissionState};

use crate::hook_config::config_for_agent_id;

// ─── Public types ────────────────────────────────────────────────────────────

/// Notification-relevant agent states. Mirrors `AgentTurnState` on the
/// frontend; `Idle` and `InProgress` are not notification-worthy and are
/// only tracked for transition detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentNotifyState {
    Idle,
    InProgress,
    Awaiting,
    Completed,
    Error,
}

impl AgentNotifyState {
    fn fires_notification(self) -> bool {
        matches!(self, Self::Awaiting | Self::Completed | Self::Error)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct NotificationService {
    app: AppHandle,
    inner: Mutex<Inner>,
}

struct Inner {
    /// Frontend-pushed projects map for project_name lookup at notify time.
    projects: HashMap<String, ProjectInfo>,
    /// Composite `<project_id>:<tab_id>` of the currently-active tab.
    active_tab: Option<String>,
    /// Window focus state (true = agent-terminal is the OS frontmost app).
    app_foreground: bool,
    /// Per-tab last-notified state — for transition detection.
    last_state: HashMap<String, AgentNotifyState>,
    /// Has the macOS permission prompt been resolved this app session?
    permission_resolved: bool,
    permission_granted: bool,
    /// Master enable toggle (mirrors a frontend localStorage key). Default: true.
    enabled: bool,
}

impl NotificationService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Mutex::new(Inner {
                projects: HashMap::new(),
                active_tab: None,
                app_foreground: true,
                last_state: HashMap::new(),
                permission_resolved: false,
                permission_granted: false,
                enabled: true,
            }),
        }
    }

    pub fn set_projects(&self, projects: Vec<ProjectInfo>) {
        let mut inner = self.inner.lock().unwrap();
        inner.projects.clear();
        for p in projects {
            inner.projects.insert(p.id.clone(), p);
        }
    }

    pub fn set_active_tab(&self, composite_tab_id: Option<String>) {
        self.inner.lock().unwrap().active_tab = composite_tab_id;
    }

    pub fn set_app_focus(&self, focused: bool) {
        self.inner.lock().unwrap().app_foreground = focused;
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.lock().unwrap().enabled = enabled;
    }

    /// Drop any pending notification and routing for `composite_tab_id`.
    /// Called when the user navigates to a tab (acknowledgement) or the
    /// tab is closed.
    pub fn cancel(&self, composite_tab_id: &str) {
        self.inner
            .lock()
            .unwrap()
            .last_state
            .remove(composite_tab_id);
        routes::clear(&identifier_for_tab(composite_tab_id));
    }

    /// Decide whether to fire and, if so, post the OS notification.
    ///
    /// Spawned async because the permission check + plugin call are async.
    /// All transition / suppression logic is synchronous and runs inside
    /// the Mutex lock so we can decide & commit `last_state` atomically.
    pub fn maybe_notify(
        self: std::sync::Arc<Self>,
        composite_tab_id: String,
        agent_id: String,
        state: AgentNotifyState,
        message: Option<String>,
    ) {
        // Step 1 — synchronous decision.
        let payload = {
            let mut inner = self.inner.lock().unwrap();

            if !inner.enabled {
                return;
            }

            // Transition detection — always update `last_state` so future
            // transitions are detected correctly, even when we don't fire.
            let prev = inner.last_state.get(&composite_tab_id).copied();
            inner
                .last_state
                .insert(composite_tab_id.clone(), state);

            if !state.fires_notification() {
                return;
            }
            if Some(state) == prev {
                return; // already notified for this state
            }

            // Suppression: window foreground AND this is the active tab.
            // (Future: tighten with xterm-focus signal — see plan rev
            // 2026-04-29.)
            if inner.app_foreground
                && inner.active_tab.as_deref() == Some(composite_tab_id.as_str())
            {
                return;
            }

            // Resolve project_id + tab_id from composite. Click routing needs
            // both (frontend's navigateToTab takes project_id + tab_id-within-
            // project). The split must succeed; if it doesn't, the composite
            // is malformed and we bail rather than misroute.
            let (project_id, tab_id_in_project) = match composite_tab_id.split_once(':') {
                Some((p, t)) if !p.is_empty() && !t.is_empty() => {
                    (p.to_string(), t.to_string())
                }
                _ => {
                    eprintln!(
                        "[notifications] malformed composite tab id: {composite_tab_id}"
                    );
                    return;
                }
            };

            // Resolve project name (fall back to project_id if not synced yet).
            let project_name = inner
                .projects
                .get(&project_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| project_id.clone());

            // Resolve display name from registry — agent-agnostic lookup.
            let display_name = config_for_agent_id(&agent_id)
                .map(|c| c.agent_name.to_string())
                .unwrap_or_else(|| agent_id.clone());

            let title = format!("{display_name} · {project_name}");
            let body = match (message, state) {
                (Some(m), _) if !m.trim().is_empty() => m,
                (_, AgentNotifyState::Awaiting) => "Needs your attention".to_string(),
                (_, AgentNotifyState::Completed) => "Turn complete".to_string(),
                (_, AgentNotifyState::Error) => "Agent exited unexpectedly".to_string(),
                _ => return, // unreachable, guarded above
            };

            FirePayload {
                composite_tab_id: composite_tab_id.clone(),
                project_id,
                tab_id_in_project,
                title,
                body,
                state,
            }
        };

        // Step 2 — async firing (permission + plugin call). Detached.
        let svc = self;
        tauri::async_runtime::spawn(async move {
            if !svc.ensure_permission().await {
                return;
            }
            let identifier = identifier_for_tab(&payload.composite_tab_id);
            let sound = match payload.state {
                AgentNotifyState::Awaiting => "Glass",
                AgentNotifyState::Completed => "Pop",
                AgentNotifyState::Error => "Basso",
                _ => "default",
            };

            let result = svc
                .app
                .notification()
                .builder()
                .title(&payload.title)
                .body(&payload.body)
                .sound(sound)
                .show();

            match result {
                Ok(()) => {
                    routes::set(
                        &identifier,
                        &payload.project_id,
                        &payload.tab_id_in_project,
                    );
                }
                Err(e) => {
                    eprintln!("[notifications] show failed: {e}");
                }
            }
        });
    }

    /// First call: ask the OS. Subsequent calls: cached answer. macOS shows
    /// the prompt the first time — see plan Journey 14 for the lazy
    /// permission UX rationale.
    async fn ensure_permission(&self) -> bool {
        // Fast path with the lock held very briefly.
        {
            let inner = self.inner.lock().unwrap();
            if inner.permission_resolved {
                return inner.permission_granted;
            }
        }

        let granted = match self.app.notification().permission_state() {
            Ok(PermissionState::Granted) => true,
            _ => match self.app.notification().request_permission() {
                Ok(PermissionState::Granted) => true,
                _ => false,
            },
        };

        let mut inner = self.inner.lock().unwrap();
        inner.permission_resolved = true;
        inner.permission_granted = granted;
        granted
    }

    /// Called by the window-focus handler in `lib.rs`. If a fresh route
    /// exists, emit `notification:click` so the frontend navigates.
    pub fn handle_window_focused(&self) {
        if let Some(route) = routes::take_fresh() {
            let _ = self.app.emit(
                "notification:click",
                serde_json::json!({
                    "project_id": route.project_id,
                    "tab_id": route.tab_id,
                }),
            );
        }
    }
}

struct FirePayload {
    composite_tab_id: String,
    project_id: String,
    tab_id_in_project: String,
    title: String,
    body: String,
    state: AgentNotifyState,
}

// ─── Tauri commands (frontend bridge) ────────────────────────────────────────

#[tauri::command]
pub async fn notif_set_projects(
    service: tauri::State<'_, std::sync::Arc<NotificationService>>,
    projects: Vec<ProjectInfo>,
) -> Result<(), String> {
    service.set_projects(projects);
    Ok(())
}

#[tauri::command]
pub async fn notif_set_active_tab(
    service: tauri::State<'_, std::sync::Arc<NotificationService>>,
    tab_id: Option<String>,
) -> Result<(), String> {
    service.set_active_tab(tab_id);
    Ok(())
}

#[tauri::command]
pub async fn notif_set_app_focus(
    service: tauri::State<'_, std::sync::Arc<NotificationService>>,
    focused: bool,
) -> Result<(), String> {
    service.set_app_focus(focused);
    Ok(())
}

#[tauri::command]
pub async fn notif_set_enabled(
    service: tauri::State<'_, std::sync::Arc<NotificationService>>,
    enabled: bool,
) -> Result<(), String> {
    service.set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub async fn notif_cancel(
    service: tauri::State<'_, std::sync::Arc<NotificationService>>,
    tab_id: String,
) -> Result<(), String> {
    service.cancel(&tab_id);
    Ok(())
}

// ─── Routing table for click → tab navigation ────────────────────────────────

fn identifier_for_tab(composite_tab_id: &str) -> String {
    format!("agent-terminal:tab:{composite_tab_id}")
}

pub mod routes {
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};

    /// Click events older than this are ignored — protects against random
    /// window-focus events (e.g. Cmd-Tab) routing to a stale tab.
    pub const CLICK_TTL: Duration = Duration::from_secs(5);

    static TABLE: OnceLock<Mutex<Vec<Entry>>> = OnceLock::new();

    #[derive(Clone)]
    pub struct Entry {
        pub identifier: String,
        pub project_id: String,
        pub tab_id: String,
        pub posted_at: Instant,
    }

    fn table() -> &'static Mutex<Vec<Entry>> {
        TABLE.get_or_init(|| Mutex::new(Vec::new()))
    }

    pub fn set(identifier: &str, project_id: &str, tab_id: &str) {
        let mut t = table().lock().unwrap();
        t.retain(|e| e.identifier != identifier);
        t.push(Entry {
            identifier: identifier.to_string(),
            project_id: project_id.to_string(),
            tab_id: tab_id.to_string(),
            posted_at: Instant::now(),
        });
    }

    pub fn clear(identifier: &str) {
        let mut t = table().lock().unwrap();
        t.retain(|e| e.identifier != identifier);
    }

    pub fn take_fresh() -> Option<Entry> {
        let mut t = table().lock().unwrap();
        let now = Instant::now();
        t.retain(|e| now.duration_since(e.posted_at) < CLICK_TTL);
        if let Some(idx) = t
            .iter()
            .enumerate()
            .max_by_key(|(_, e)| e.posted_at)
            .map(|(i, _)| i)
        {
            return Some(t.remove(idx));
        }
        None
    }
}
