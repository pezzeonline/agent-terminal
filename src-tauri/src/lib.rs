mod commands;
// `pub` so integration tests in `tests/` can call `ensure_hooks_installed()` and
// build payloads against `HookPayload`. Internal API otherwise — the app uses these
// modules directly.
pub mod hook_config;
pub mod hook_server;
mod mod_engine;
mod notifications;
mod pty_manager;
mod shell_integration;

use hook_config::ensure_hooks_installed;
use hook_server::start_hook_server;
use mod_engine::{
    ModEngine,
    mods::{
        AgentTurnMod,
        ClaudeCodeMod,
        CodexMod,
        DirTrackerMod,
        GitMonitorMod,
        ProcessTrackerMod,
        ShellProcessMod,
    },
};
use notifications::NotificationService;
use shell_integration::setup_shell_integration;
use tauri::{Manager, WindowEvent};
use pty_manager::PtyMap;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_map: PtyMap = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Best-effort: write shell integration scripts. Never fail app startup.
            if let Err(e) = setup_shell_integration() {
                eprintln!("[agent-terminal] shell integration setup failed: {e}");
            }

            // Silently install/verify agent hook configs at every launch.
            // Runs in the background — never blocks startup, never crashes the app.
            tauri::async_runtime::spawn(ensure_hooks_installed());

            // Notification service — single owner of OS notifications.
            // Created here so AgentTurnMod can take a reference and the
            // window-focus handler can route clicks through it.
            let notification_service = Arc::new(NotificationService::new(app.handle().clone()));
            app.manage(notification_service.clone());

            // Build the mod engine. Hook channel is created inside the builder.
            let engine_builder = ModEngine::builder()
                .with_mod(DirTrackerMod::new())
                .with_mod(ProcessTrackerMod::new())
                .with_mod(ClaudeCodeMod::new())
                .with_mod(CodexMod::new())
                .with_mod(ShellProcessMod::new())
                .with_mod(GitMonitorMod::new())
                .with_mod(AgentTurnMod::new().with_notifications(notification_service.clone()));

            // Start the hook HTTP server, wired to the engine's hook channel.
            let hook_tx = engine_builder.hook_sender();
            start_hook_server(hook_tx);

            let mod_engine = engine_builder.build(app.handle().clone());
            app.manage(mod_engine);

            // Notification click → window focus → tab routing.
            // When the user clicks a notification banner, macOS focuses the
            // app window. We piggyback on that focus event: if there's a
            // fresh route entry (posted within CLICK_TTL), assume it was a
            // notification click and emit `notification:click` for the
            // frontend to navigate to the right tab.
            if let Some(window) = app.get_webview_window("main") {
                let svc = notification_service.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(focused) = event {
                        // Update the foreground signal so suppression decisions
                        // see the latest state without a frontend roundtrip.
                        svc.set_app_focus(*focused);
                        if *focused {
                            svc.handle_window_focused();
                        }
                    }
                });
            }

            Ok(())
        })
        .manage(pty_map)
        .invoke_handler(tauri::generate_handler![
            commands::open_tab,
            commands::write_pty,
            commands::resize_pty,
            commands::close_tab,
            commands::list_projects,
            commands::save_projects,
            notifications::notif_set_projects,
            notifications::notif_set_active_tab,
            notifications::notif_set_app_focus,
            notifications::notif_set_enabled,
            notifications::notif_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
