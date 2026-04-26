//! Integration tests for the hook pipeline.
//!
//! These tests invoke the real hook scripts installed at `~/.agent-terminal/hooks/`
//! and verify that they correctly transform and POST payloads to the hook server.
//! They also validate that the script returns immediately under failure modes
//! that would otherwise hang Claude Code (the 2026-04-26 incident).
//!
//! # Running
//!
//! ```sh
//! cargo test --manifest-path src-tauri/Cargo.toml --test hook_integration -- --test-threads=1
//! ```
//!
//! `--test-threads=1` is REQUIRED — every test in this file binds (or asserts
//! the absence of a binding on) port 47384. Parallel execution would race.
//! The tests internally serialize with a Mutex as a defence-in-depth measure,
//! but the test runner can still interleave with other tests in other files.
//!
//! Tests that touch real config files are marked `#[ignore]`. Run with:
//!
//! ```sh
//! cargo test --manifest-path src-tauri/Cargo.toml --test hook_integration -- --include-ignored --test-threads=1
//! ```

use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::{Duration, timeout};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Cross-test serialization for port 47384. Tests cannot run in parallel because
/// they all share this single fixed port. The integration tests assume
/// `--test-threads=1`, but the mutex is also held inside each test as a guard
/// against accidental parallelism.
fn port_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Acquires `port_lock()`, recovering from poisoning. Without this, a single
/// panicking test would cascade into PoisonError panics in every subsequent
/// test, masking the real failure.
fn acquire_port_lock() -> std::sync::MutexGuard<'static, ()> {
    port_lock().lock().unwrap_or_else(|e| e.into_inner())
}

fn hook_scripts_dir() -> PathBuf {
    dirs::home_dir()
        .expect("no home dir")
        .join(".agent-terminal")
        .join("hooks")
}

fn claude_hook() -> PathBuf {
    hook_scripts_dir().join("claude-hook")
}

fn codex_hook() -> PathBuf {
    hook_scripts_dir().join("codex-hook")
}

/// Try to bind port 47384. Returns the listener or None if the port is busy.
async fn try_bind_hook_port() -> Option<TcpListener> {
    TcpListener::bind("127.0.0.1:47384").await.ok()
}

type Received = Arc<Mutex<VecDeque<Value>>>;

#[derive(Deserialize)]
struct AnyPayload(Value);

async fn collect_hook(
    State(received): State<Received>,
    Json(AnyPayload(payload)): Json<AnyPayload>,
) -> StatusCode {
    received.lock().unwrap().push_back(payload);
    StatusCode::OK
}

/// Server handle that shuts down on drop, freeing port 47384 for the next test.
struct CollectorServer {
    received: Received,
    shutdown: Option<oneshot::Sender<()>>,
}

impl Drop for CollectorServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

/// Starts the hook HTTP server on the given listener. Returns a handle that
/// owns the shutdown signal and the received-payloads queue.
fn start_collector(listener: TcpListener) -> CollectorServer {
    let received: Received = Arc::new(Mutex::new(VecDeque::new()));
    let rx_state = received.clone();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let app = Router::new()
        .route("/hook", post(collect_hook))
        .with_state(rx_state);
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    CollectorServer {
        received,
        shutdown: Some(shutdown_tx),
    }
}

/// Pipes `payload` to `script event` via stdin and waits for the child to exit.
/// Returns the elapsed wall-clock time.
fn run_hook(script: &PathBuf, event: &str, payload: &str) -> Duration {
    let start = Instant::now();
    let mut child = Command::new(script)
        .arg(event)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn {}: {e}", script.display()));

    use std::io::Write;
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(payload.as_bytes())
        .unwrap();
    child.wait().expect("hook script did not exit");
    start.elapsed()
}

/// Polls the received queue until a payload arrives or the timeout expires.
async fn wait_for_payload(received: &Received) -> Option<Value> {
    timeout(Duration::from_secs(3), async {
        loop {
            if let Some(p) = received.lock().unwrap().pop_front() {
                return p;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .ok()
}

// ─── I1: Claude hook script fires with correct agent/event fields ─────────────

#[tokio::test]
async fn i1_claude_hook_fires_session_start() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i1: claude-hook not installed at {}", script.display());
        return;
    }

    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i1: port 47384 busy (agent-terminal running?)");
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"test-session-i1","cwd":"/tmp/i1-project","transcript_path":"/tmp/i1.jsonl"}"#;
    run_hook(&script, "SessionStart", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "claude-code", "agent field injected");
    assert_eq!(got["event"], "SessionStart", "event field injected");
    assert_eq!(got["session_id"], "test-session-i1", "session_id preserved");
    assert_eq!(got["cwd"], "/tmp/i1-project", "cwd preserved");
    assert_eq!(got["transcript_path"], "/tmp/i1.jsonl", "transcript_path preserved");
}

// ─── I2: Claude hook fires for PreToolUse (includes tool_name) ───────────────

#[tokio::test]
async fn i2_claude_hook_fires_pre_tool_use() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i2: claude-hook not installed");
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i2: port 47384 busy");
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"test-session-i2","cwd":"/tmp/i2-project","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
    run_hook(&script, "PreToolUse", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "claude-code");
    assert_eq!(got["event"], "PreToolUse");
    assert_eq!(got["tool_name"], "Bash");
}

// ─── I3: Codex hook script fires with correct agent/event fields ──────────────

#[tokio::test]
async fn i3_codex_hook_fires_session_start() {
    let _g = acquire_port_lock();

    let script = codex_hook();
    if !script.exists() {
        eprintln!("SKIP i3: codex-hook not installed at {}", script.display());
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i3: port 47384 busy");
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"codex-session-i3","cwd":"/tmp/i3-project"}"#;
    run_hook(&script, "SessionStart", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "codex", "agent field injected");
    assert_eq!(got["event"], "SessionStart", "event field injected");
    assert_eq!(got["session_id"], "codex-session-i3", "session_id preserved");
    assert_eq!(got["cwd"], "/tmp/i3-project", "cwd preserved");
}

// ─── I4: Codex Stop hook fires correctly ─────────────────────────────────────

#[tokio::test]
async fn i4_codex_hook_fires_stop() {
    let _g = acquire_port_lock();

    let script = codex_hook();
    if !script.exists() {
        eprintln!("SKIP i4: codex-hook not installed");
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i4: port 47384 busy");
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"codex-session-i4","cwd":"/tmp/i4-project","last_assistant_message":"Done."}"#;
    run_hook(&script, "Stop", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "codex");
    assert_eq!(got["event"], "Stop");
    assert_eq!(got["last_assistant_message"], "Done.");
}

// ─── I7: Hook script exits fast when nothing is listening on 47384 ────────────
//
// Regression test: confirms ECONNREFUSED is fast on macOS and the script
// doesn't hang when agent-terminal is closed. Pre-fix this passed (curl fails
// in ~25ms on its own), but the test exists to lock that behavior in.

#[tokio::test]
async fn i7_hook_script_does_not_hang_when_server_absent() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i7: claude-hook not installed");
        return;
    }

    // Confirm port really is free. If an external process holds it, skip
    // rather than report a misleading failure.
    if try_bind_hook_port().await.is_none() {
        eprintln!("SKIP i7: port 47384 busy — cannot test absent-server case");
        return;
    }
    // (Listener dropped immediately above so the script sees a free port.)

    let payload = r#"{"session_id":"i7","cwd":"/tmp/i7"}"#;
    let elapsed = run_hook(&script, "SessionStart", payload);

    assert!(
        elapsed < Duration::from_secs(1),
        "hook script took {elapsed:?} when nothing was listening — should be <1s"
    );
}

// ─── I8: Hook script exits fast when listener accepts but never responds ──────
//
// THIS is the 2026-04-26 regression test. Without fire-and-forget detach,
// this test hangs for ~60 seconds (curl waits for a response that never comes).
// With fire-and-forget, the script exits in milliseconds regardless.

#[tokio::test]
async fn i8_hook_script_does_not_hang_when_server_unresponsive() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i8: claude-hook not installed");
        return;
    }

    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i8: port 47384 busy");
        return;
    };

    // Spawn an "accept-but-never-respond" loop. We accept incoming connections
    // (so the kernel doesn't return ECONNREFUSED), then immediately drop the
    // socket without reading or writing. The connection stays open from curl's
    // POV; curl waits for a response that will never come.
    //
    // We hold the connections in a Vec so they don't get closed (which would
    // make curl notice EOF and exit). They're released when the test ends.
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    let acceptor = tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                Ok((conn, _)) = listener.accept() => {
                    held.push(conn);
                }
            }
        }
    });

    let payload = r#"{"session_id":"i8","cwd":"/tmp/i8"}"#;
    let elapsed = run_hook(&script, "SessionStart", payload);

    // Tell the acceptor to stop and drop its held connections.
    let _ = stop_tx.send(());
    let _ = acceptor.await;

    assert!(
        elapsed < Duration::from_secs(1),
        "REGRESSION: hook script took {elapsed:?} against unresponsive server. \
         Fire-and-forget detach is broken — script is waiting for curl response. \
         See plans/.../2026-04-26-0830-claude-code-agent-turn-detection.md \
         'Post-Implementation Bug — 2026-04-26' section."
    );
}

// ─── I5: Real Claude settings.json has no duplicate entries (ignored) ─────────

#[tokio::test]
#[ignore]
async fn i5_real_claude_settings_no_duplicates() {
    let home = dirs::home_dir().expect("no home dir");
    let settings = home.join(".claude").join("settings.json");

    if !settings.exists() {
        eprintln!("SKIP i5: ~/.claude/settings.json not found");
        return;
    }

    let raw = tokio::fs::read_to_string(&settings).await.unwrap();
    let v: Value = serde_json::from_str(&raw).expect("settings.json is not valid JSON");

    // Missing "hooks" object is not a failure — just means agent-terminal
    // hasn't installed any hooks yet (or Claude Code reset the file). The test
    // only fires if our entries exist, in which case they must be deduplicated.
    let Some(hooks) = v["hooks"].as_object() else {
        eprintln!("SKIP i5: ~/.claude/settings.json has no \"hooks\" object — nothing to check");
        return;
    };

    let our_prefix = home
        .join(".agent-terminal")
        .join("hooks")
        .join("claude-hook")
        .to_string_lossy()
        .to_string();

    for (event, entries) in hooks {
        let arr = entries.as_array().expect("event array is not an array");
        let mut commands: Vec<String> = vec![];
        for entry in arr {
            if let Some(inner) = entry.get("hooks").and_then(|h| h.as_array()) {
                for h in inner {
                    if let Some(cmd) = h.get("command").and_then(|c| c.as_str()) {
                        commands.push(cmd.to_string());
                    }
                }
            }
        }
        let our_cmds: Vec<_> = commands
            .iter()
            .filter(|c| c.starts_with(&our_prefix))
            .collect();
        assert!(
            our_cmds.len() <= 1,
            "duplicate agent-terminal entry in {event}: {our_cmds:?}"
        );
    }
}

// ─── I6: Real Codex hooks.json has no duplicate entries (ignored) ─────────────

#[tokio::test]
#[ignore]
async fn i6_real_codex_hooks_no_duplicates() {
    let home = dirs::home_dir().expect("no home dir");
    let hooks_file = home.join(".codex").join("hooks.json");

    if !hooks_file.exists() {
        eprintln!("SKIP i6: ~/.codex/hooks.json not found");
        return;
    }

    let raw = tokio::fs::read_to_string(&hooks_file).await.unwrap();
    let v: Value = serde_json::from_str(&raw).expect("hooks.json is not valid JSON");

    let Some(hooks) = v["hooks"].as_object() else {
        eprintln!("SKIP i6: ~/.codex/hooks.json has no \"hooks\" object");
        return;
    };
    let our_prefix = home
        .join(".agent-terminal")
        .join("hooks")
        .join("codex-hook")
        .to_string_lossy()
        .to_string();

    for (event, entries) in hooks {
        let arr = entries.as_array().expect("event array is not an array");
        let our_cmds: Vec<_> = arr
            .iter()
            .filter_map(|e| e.get("command").and_then(|c| c.as_str()))
            .filter(|c| c.starts_with(&our_prefix))
            .collect();
        assert!(
            our_cmds.len() <= 1,
            "duplicate agent-terminal entry in {event}: {our_cmds:?}"
        );
    }
}
