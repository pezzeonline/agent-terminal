// WSS server for the mobile companion. Bound to the dev-config's
// bind_addr (defaults to 0.0.0.0:47823 — LAN-accessible so a phone on
// the same Wi-Fi can reach it). One route in Phase 1: `/stream`.
//
// Connection lifecycle:
//   1. WebSocket upgrade on `/stream`.
//   2. Client sends `ClientFrame::Auth`. Server validates against the
//      AuthStub's bearer token via constant-time compare.
//   3. Server replies `ServerFrame::AuthOk` + immediately pushes a
//      `ServerFrame::Projects` frame with the current tab tree.
//   4. Server enters the frame-dispatch loop (lands in the next
//      commit — this initial commit closes the connection right after
//      the AuthOk + Projects push).
//
// Auth is intentionally minimal — a single bearer token from the dev
// config file. Phase 2 replaces the whole flow with the QR-code pairing
// handshake per-device tokens stored in the macOS Keychain.

use crate::auth_stub::AuthStub;
use crate::mod_engine::{CwdTable, ModEngineHandle};
use crate::projects_cache::ProjectsCache;
use crate::protocol::{ClientFrame, ServerFrame};
use crate::pty_manager::{spawn_pty_if_absent, PtyMap};
use crate::stream_hub::{StreamHub, SubscriberId};
use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::get,
};
use portable_pty::PtySize;
use std::collections::HashMap;
use std::io::{self, Write};
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

#[derive(Debug, Error)]
pub enum WssError {
    #[error("bind {addr}: {source}")]
    Bind {
        addr: SocketAddr,
        #[source]
        source: io::Error,
    },
    #[error("serve: {0}")]
    Serve(#[from] io::Error),
}

/// Handles passed to each connection task. Cloneable via `Arc`; per-
/// connection state lives inside the task itself.
pub struct ServerState {
    pub hub: Arc<StreamHub>,
    pub auth: Arc<AuthStub>,
    /// Cache of the desktop's full project + tab tree. Populated by React
    /// via `sync_projects_to_wss` (source of truth for mutations) and
    /// pre-loaded from `projects.json` on cold start so a mobile client
    /// that connects before React has finished mounting sees something
    /// useful.
    pub projects_cache: Arc<ProjectsCache>,
    /// Shared with the Tauri app so a Write / Resize frame from a
    /// remote client writes to the same PtyHandle the desktop
    /// frontend does. Concurrent access under the existing
    /// `Mutex<HashMap>` is fine at Phase 1 keystroke rates; if
    /// contention shows in profiling we split the lock.
    pub pty_map: PtyMap,
    pub mod_engine_handle: ModEngineHandle,
    /// Tab OSC 7 cwd table, shared with the mod engine + the desktop
    /// spawn path. Auto-spawn on Subscribe resolves the initial cwd of
    /// a sleeping tab against `last_cwd` from the ProjectsCache first;
    /// this table is threaded to spawn_pty for symmetry with the
    /// desktop's open_tab flow so a subsequent local visit lands in the
    /// same cwd via OSC 7.
    pub cwd_table: CwdTable,
    /// AppHandle for the Tauri commands + events spawn_pty emits
    /// (pty:exit, pty:respawned). Cloned into each auto-spawn call.
    /// `Option` so integration tests can build a ServerState without
    /// standing up a full Tauri mock runtime; the auto-spawn branch
    /// gates on `Some` and treats `None` as "no-op, don't spawn".
    pub app_handle: Option<tauri::AppHandle>,
}

/// Bind the WSS server to `addr` and serve until the listener closes.
/// `lib.rs` spawns this as a tokio task and doesn't await its
/// completion; a bind failure logs and returns without blocking desktop
/// startup.
pub async fn run(addr: SocketAddr, state: Arc<ServerState>) -> Result<(), WssError> {
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|source| WssError::Bind { addr, source })?;
    run_with_listener(listener, state).await
}

/// Serve on an already-bound listener. Public so integration tests can
/// hold the port from allocation through serving — no drop-then-rebind
/// race, no sleep waiting for the server to come up. Production callers
/// go through `run(addr, state)` which binds first, then delegates here.
pub async fn run_with_listener(
    listener: TcpListener,
    state: Arc<ServerState>,
) -> Result<(), WssError> {
    let addr = listener
        .local_addr()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
    // Loud dev-only warning so anyone reading the terminal knows this
    // server is exposed to the LAN with no TLS. Phase 2 introduces the
    // TOFU-pinned self-signed cert.
    eprintln!(
        "[wss] listening on {addr} — LAN-exposed, dev only, no TLS. \
         Token in the companion-dev.json config file"
    );

    let app = Router::new()
        .route("/stream", get(handle_stream_upgrade))
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

/// axum handler for `/stream`. Just performs the WebSocket upgrade and
/// hands off to `connection_task`; all the interesting logic lives there.
async fn handle_stream_upgrade(
    State(state): State<Arc<ServerState>>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| connection_task(socket, state))
}

/// Per-connection lifecycle. Reads frames, dispatches them, pushes
/// replies. This initial commit only handles auth + the initial Projects
/// push. The next commit wires the full ClientFrame dispatch loop.
async fn connection_task(mut socket: WebSocket, state: Arc<ServerState>) {
    // Step 1: read the auth frame.
    let auth_frame = match read_frame(&mut socket).await {
        Ok(Some(f)) => f,
        Ok(None) => {
            // Client closed before sending auth. Nothing to do.
            return;
        }
        Err(e) => {
            eprintln!("[wss] read auth frame failed: {e}");
            return;
        }
    };

    let token = match auth_frame {
        ClientFrame::Auth { token } => token,
        other => {
            // Any non-Auth first frame is a protocol error.
            let _ = send_frame(
                &mut socket,
                &ServerFrame::AuthFail {
                    reason: format!(
                        "expected Auth as first frame, got {}",
                        first_op_name(&other)
                    ),
                },
            )
            .await;
            return;
        }
    };

    // Step 2: validate.
    if !state.auth.check(&token) {
        let _ = send_frame(
            &mut socket,
            &ServerFrame::AuthFail {
                reason: "bad token".to_string(),
            },
        )
        .await;
        return;
    }

    // Step 3: auth-ok + immediate Projects push.
    if send_frame(
        &mut socket,
        &ServerFrame::AuthOk {
            device_name: state.auth.device_name.clone(),
        },
    )
    .await
    .is_err()
    {
        return;
    }
    let projects = state.projects_cache.projects_with_spawn_status(&state.pty_map);
    if send_frame(&mut socket, &ServerFrame::Projects { data: projects })
        .await
        .is_err()
    {
        return;
    }

    // Step 4: enter the frame dispatch loop.
    //
    // Per-connection state:
    // - `outbox_tx` / `outbox_rx` is the mpsc the StreamHub pushes
    //   Bytes/Snapshot frames onto (Remote subscribers each own an
    //   outbox clone). The main select! below drains outbox_rx onto
    //   the WebSocket alongside handling client frames.
    // - `subscriptions` tracks the SubscriberId per tab_id so
    //   Unsubscribe / disconnect can clean up hub state.
    // - `changes` fires whenever the tab inventory mutates
    //   (open_tab, close_tab, respawn_in_place). We push a fresh
    //   Projects frame to the outbox in response so the mobile UI's
    //   tab tree stays live-synced with the desktop's.
    let (outbox_tx, mut outbox_rx) = mpsc::unbounded_channel::<ServerFrame>();
    let mut subscriptions: HashMap<String, SubscriberId> = HashMap::new();
    let mut changes = state.projects_cache.subscribe_changes();
    // Consume the current value so `changed().await` blocks until the
    // NEXT notify — otherwise the first iteration would fire
    // immediately and re-send the projects we just pushed above.
    changes.mark_unchanged();

    loop {
        tokio::select! {
            // Client → server: read a frame, dispatch.
            incoming = read_frame(&mut socket) => {
                let frame = match incoming {
                    Ok(Some(f)) => f,
                    Ok(None) => break,
                    Err(e) => {
                        eprintln!("[wss] read error: {e}");
                        break;
                    }
                };
                dispatch_client_frame(
                    frame,
                    &state,
                    &outbox_tx,
                    &mut subscriptions,
                )
                .await;
            }

            // Server → client: outbox drained onto the WebSocket. The
            // outbox_tx clone in `subscriptions` keeps this alive; when
            // all clones drop (i.e. connection torn down), this branch
            // returns None and the select! moves on. We break in that
            // case so the connection cleanly closes.
            frame = outbox_rx.recv() => {
                let Some(frame) = frame else { break };
                if send_frame(&mut socket, &frame).await.is_err() {
                    break;
                }
            }

            // ProjectsCache changed (React synced a fresh $projects
            // via sync_projects_to_wss, or a cold-start load ran).
            // Re-read the tree and enqueue a fresh Projects frame.
            // Any send error on `changed().await` means the sender
            // has been dropped — impossible in practice (cache is
            // long-lived) but treat as a clean exit anyway.
            change = changes.changed() => {
                if change.is_err() { break; }
                let projects = state.projects_cache.projects_with_spawn_status(&state.pty_map);
                let _ = outbox_tx.send(ServerFrame::Projects { data: projects });
            }
        }
    }

    // Cleanup: drop every remaining subscription so the hub reclaims
    // its per-tab bookkeeping. Runs on any exit from the loop (client
    // close, read error, outbox drained).
    for (tab_id, sub_id) in subscriptions {
        state.hub.unsubscribe(&tab_id, sub_id);
    }
}

/// Route a single ClientFrame to its handler. Kept as a standalone
/// function so the main connection_task select! stays legible.
async fn dispatch_client_frame(
    frame: ClientFrame,
    state: &Arc<ServerState>,
    outbox_tx: &mpsc::UnboundedSender<ServerFrame>,
    subscriptions: &mut HashMap<String, SubscriberId>,
) {
    match frame {
        // The main auth path already handled the first Auth frame. A
        // second one is a protocol error but not worth tearing down for
        // — silently ignore.
        ClientFrame::Auth { .. } => {}

        ClientFrame::Subscribe { tab_id, scrollback } => {
            // Auto-spawn: mobile clients see every tab the desktop knows
            // about, including sleeping ones. Tapping a sleeping tab
            // lands here with no PtyHandle in the map. Create one from
            // the cache's TabSummary metadata so mobile can drive the
            // shell without the desktop having to visit the tab first.
            //
            // cwd chain: TabSummary.last_cwd (OSC 7-derived, persisted)
            // → TabSummary.cwd → spawn_pty's HOME default. Shell comes
            // from `cmd` when set, matching desktop's semantics.
            let needs_spawn = !state.pty_map.lock().unwrap().contains_key(&tab_id);
            if needs_spawn {
                if let (Some(app), Some(tab)) = (
                    state.app_handle.as_ref(),
                    state.projects_cache.find_tab(&tab_id),
                ) {
                    let cwd = tab.last_cwd.clone().or_else(|| tab.cwd.clone());
                    let shell = tab.cmd.clone();
                    match spawn_pty_if_absent(
                        app.clone(),
                        &state.pty_map,
                        state.mod_engine_handle.clone(),
                        state.cwd_table.clone(),
                        Arc::clone(&state.hub),
                        Some(Arc::clone(&state.projects_cache)),
                        tab_id.clone(),
                        cwd,
                        shell,
                    ) {
                        Ok(true) => {
                            // is_spawned overlay just flipped for this
                            // tab; broadcast so every mobile client sees
                            // the change in the next Projects push.
                            state.projects_cache.notify_spawn_change();
                        }
                        Ok(false) => {}
                        Err(e) => eprintln!("[wss] auto-spawn {tab_id} failed: {e}"),
                    }
                }
            }

            // Drop any prior subscription on the same tab first so we
            // don't leak SubscriberIds if a client re-subscribes.
            if let Some(prev) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, prev);
            }
            // subscribe_remote returns None if the outbox closed during
            // initial Snapshot / ring replay. Nothing to track; the
            // connection is about to unwind on its own.
            if let Some(id) = state
                .hub
                .subscribe_remote(&tab_id, outbox_tx.clone(), scrollback)
                .await
            {
                subscriptions.insert(tab_id, id);
            }
        }

        ClientFrame::Resume {
            tab_id,
            scrollback,
            last_seq,
        } => {
            if let Some(prev) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, prev);
            }
            if let Some(id) = state
                .hub
                .resume_remote(&tab_id, outbox_tx.clone(), last_seq, scrollback)
                .await
            {
                subscriptions.insert(tab_id, id);
            }
        }

        ClientFrame::Unsubscribe { tab_id } => {
            if let Some(id) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, id);
            }
        }

        ClientFrame::Write { tab_id, data } => {
            // Look up the PtyHandle and write bytes to its master.
            // Matches `commands::write_pty` behaviour byte-for-byte:
            // silently no-op if the tab is already closed, then feed
            // the mod engine.
            let bytes = data.into_bytes();
            {
                let mut map = state.pty_map.lock().expect("pty_map lock poisoned");
                if let Some(handle) = map.get_mut(&tab_id) {
                    if let Err(e) = handle.writer.write_all(&bytes) {
                        eprintln!("[wss] write to {tab_id} failed: {e}");
                    }
                }
            }
            state.mod_engine_handle.on_input(&tab_id, bytes);
        }

        ClientFrame::Resize {
            tab_id,
            cols,
            rows,
        } => {
            {
                let map = state.pty_map.lock().expect("pty_map lock poisoned");
                if let Some(handle) = map.get(&tab_id) {
                    if let Err(e) = handle.master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    }) {
                        eprintln!("[wss] resize {tab_id} failed: {e}");
                    }
                }
            }
            state.mod_engine_handle.on_resize(&tab_id, cols, rows);
            // Keep the sidecar's shadow xterm in step so a subsequent
            // Snapshot from a re-subscribing client sees the right
            // dimensions.
            state.hub.resize_tab(&tab_id, cols, rows);
        }

        ClientFrame::Ping => {
            let _ = outbox_tx.send(ServerFrame::Pong);
        }
    }
}

/// Read the next text/binary frame as a ClientFrame. Returns `Ok(None)`
/// on a clean close. Ignores WebSocket Ping/Pong control frames (axum
/// handles those transparently but the loop still sees them).
async fn read_frame(socket: &mut WebSocket) -> Result<Option<ClientFrame>, ReadFrameError> {
    loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                let frame: ClientFrame = serde_json::from_str(text.as_str())
                    .map_err(ReadFrameError::BadJson)?;
                return Ok(Some(frame));
            }
            Some(Ok(Message::Binary(bytes))) => {
                let frame: ClientFrame = serde_json::from_slice(&bytes)
                    .map_err(ReadFrameError::BadJson)?;
                return Ok(Some(frame));
            }
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            Some(Ok(Message::Close(_))) | None => return Ok(None),
            Some(Err(e)) => return Err(ReadFrameError::Socket(e.to_string())),
        }
    }
}

#[derive(Debug, Error)]
enum ReadFrameError {
    #[error("bad json: {0}")]
    BadJson(#[from] serde_json::Error),
    #[error("socket: {0}")]
    Socket(String),
}

/// Serialise and send a ServerFrame as a text WebSocket message.
async fn send_frame(socket: &mut WebSocket, frame: &ServerFrame) -> Result<(), axum::Error> {
    let json = serde_json::to_string(frame).expect("ServerFrame must always serialise");
    socket.send(Message::Text(json.into())).await
}

/// Human-readable variant name for the "expected Auth" error message.
fn first_op_name(frame: &ClientFrame) -> &'static str {
    match frame {
        ClientFrame::Auth { .. } => "auth",
        ClientFrame::Subscribe { .. } => "subscribe",
        ClientFrame::Resume { .. } => "resume",
        ClientFrame::Unsubscribe { .. } => "unsubscribe",
        ClientFrame::Write { .. } => "write",
        ClientFrame::Resize { .. } => "resize",
        ClientFrame::Ping => "ping",
    }
}
