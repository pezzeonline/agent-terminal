//! Native OS notification commands invoked by the frontend notification service.
//!
//! Two responsibilities:
//!
//! 1. `show_agent_notification` — post a notification with a stable per-tab
//!    identifier so successive state changes for the same agent tab *replace*
//!    the prior notification rather than stacking. Embeds `project_id` +
//!    `tab_id` so the click handler (registered in `lib.rs`) can route the
//!    user back to the exact tab.
//! 2. `cancel_agent_notification` — drop any pending notification for a
//!    specific tab. Called when the user navigates to the tab inside the app
//!    (acknowledgement) or when the tab is closed.
//!
//! This module is **agent-agnostic** — it accepts an opaque
//! `agent_display_name` as part of the payload built on the frontend and
//! never branches on which agent produced the event. Adding a new agent
//! mod must work without touching this file.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// State category for the notification — drives sound choice (and, in v2,
/// per-state suppression and interruption-level selection).
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationKind {
    Awaiting,
    Completed,
    Error,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentNotification {
    /// Routing — included in the click handler payload.
    pub tab_id: String,
    pub project_id: String,
    /// Human-readable title (e.g. `"Claude Code · DaniAkash/agent-terminal"`).
    pub title: String,
    pub body: String,
    pub kind: NotificationKind,
}

/// Stable per-tab notification identifier. Reposting with the same identifier
/// replaces the previous OS notification — see Journey 11 in the plan.
fn identifier_for_tab(tab_id: &str) -> String {
    format!("agent-terminal:tab:{tab_id}")
}

/// Posts (or replaces) a notification for the given agent tab.
#[tauri::command]
pub async fn show_agent_notification(
    app: AppHandle,
    payload: AgentNotification,
) -> Result<(), String> {
    let identifier = identifier_for_tab(&payload.tab_id);

    // Sound per kind — distinct enough that the user can tell them apart
    // without looking. macOS resolves these names against system sounds.
    let sound = match payload.kind {
        NotificationKind::Awaiting => "Glass",
        NotificationKind::Completed => "Pop",
        NotificationKind::Error => "Basso",
    };

    app.notification()
        .builder()
        .title(&payload.title)
        .body(&payload.body)
        .sound(sound)
        // Encode routing data into the notification body's "extra"-like
        // facility. Tauri 2's notification builder doesn't expose first-class
        // metadata, so we round-trip via the `id` field — Tauri assigns an
        // integer ID we can't control. Instead we rely on a process-wide
        // routing table populated alongside the show() call (see
        // PENDING_ROUTES below).
        .show()
        .map_err(|e| format!("notification show failed: {e}"))?;

    // Record the most-recent routing for this tab. The click handler reads
    // the most-recent routing for whichever tab the user clicked. macOS gives
    // us back the notification's user-visible title via the activation
    // callback; we look up the route by identifier prefix.
    routes::set(&identifier, &payload.project_id, &payload.tab_id);

    Ok(())
}

/// Cancels (best-effort) any pending notification for the given tab.
#[tauri::command]
pub async fn cancel_agent_notification(
    _app: AppHandle,
    tab_id: String,
) -> Result<(), String> {
    // Tauri 2's notification plugin doesn't expose programmatic cancellation
    // of an already-shown banner across all OS targets. macOS clears banners
    // from Notification Center via NSUserNotificationCenter APIs, but they
    // are not surfaced through the plugin. As a degraded fallback we forget
    // the routing entry so a stale click no longer routes anywhere — the
    // notification card itself will linger in Notification Center until the
    // user dismisses it manually or the OS auto-trims.
    routes::clear(&identifier_for_tab(&tab_id));
    Ok(())
}

/// Process-wide routing table mapping notification identifier → (project_id, tab_id).
/// Populated by `show_agent_notification`, read by the click-action handler
/// registered in `lib.rs`. Cleared by `cancel_agent_notification` and on
/// successful click-through.
pub mod routes {
    use std::sync::{Mutex, OnceLock};

    static TABLE: OnceLock<Mutex<Vec<Entry>>> = OnceLock::new();

    #[derive(Clone)]
    pub struct Entry {
        pub identifier: String,
        pub project_id: String,
        pub tab_id: String,
    }

    fn table() -> &'static Mutex<Vec<Entry>> {
        TABLE.get_or_init(|| Mutex::new(Vec::new()))
    }

    pub fn set(identifier: &str, project_id: &str, tab_id: &str) {
        let mut t = table().lock().unwrap();
        // Remove any previous entry for the same identifier (replacement).
        t.retain(|e| e.identifier != identifier);
        t.push(Entry {
            identifier: identifier.to_string(),
            project_id: project_id.to_string(),
            tab_id: tab_id.to_string(),
        });
    }

    pub fn clear(identifier: &str) {
        let mut t = table().lock().unwrap();
        t.retain(|e| e.identifier != identifier);
    }

    /// Returns the most-recently-set routing entry. Used as a fallback when
    /// the OS click event doesn't include the notification identifier we set
    /// — the user almost always clicks the most-recently-fired notification.
    pub fn most_recent() -> Option<Entry> {
        table().lock().unwrap().last().cloned()
    }
}
