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
use crate::project_registry::ProjectRegistry;
use crate::protocol::{ClientFrame, ServerFrame};
use crate::stream_hub::StreamHub;
use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::get,
};
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;

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
    pub registry: Arc<ProjectRegistry>,
}

/// Bind the WSS server to `addr` and serve until the listener closes.
/// `lib.rs` spawns this as a tokio task and doesn't await its
/// completion; a bind failure logs and returns without blocking desktop
/// startup.
pub async fn run(addr: SocketAddr, state: Arc<ServerState>) -> Result<(), WssError> {
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|source| WssError::Bind { addr, source })?;
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
    let projects = state.registry.projects();
    if send_frame(&mut socket, &ServerFrame::Projects { data: projects })
        .await
        .is_err()
    {
        return;
    }

    // Step 4: dispatch loop lands in the next commit. For now, just
    // drain any subsequent frames so a wscat probe doesn't see the
    // connection close immediately after Projects — the client observes
    // "connected + authed" until it disconnects on its own.
    loop {
        match socket.recv().await {
            Some(Ok(Message::Close(_))) | None => break,
            Some(Ok(_)) => {
                // Silently drop until the dispatcher lands.
            }
            Some(Err(e)) => {
                eprintln!("[wss] recv error: {e}");
                break;
            }
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
