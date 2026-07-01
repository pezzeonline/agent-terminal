// JSON-over-WebSocket wire protocol between the desktop server and any
// paired mobile client. This file is the single source of truth: the
// TypeScript equivalent under `companion/src/modules/wss/protocol.gen.ts`
// is generated from these types via `cargo xtask regen-protocol` and
// checked for drift on every PR.
//
// Encoding notes for the load-bearing variants:
//
// - `ServerFrame::Bytes { data }` — base64 of the raw PTY bytes. JSON
//   cannot carry arbitrary binary cleanly; mirrors the sidecar's `write`
//   op for symmetry. The mobile client decodes base64 → bytes before
//   feeding the xterm.js Terminal.
//
// - `ServerFrame::Snapshot { payload }` — the xterm-serialize output. By
//   construction a valid UTF-8 string of ANSI escape sequences ready to
//   replay into a fresh xterm.js Terminal. Kept raw (not base64) so the
//   largest frames in the system don't pay a 33% base64 tax.
//
// - `ClientFrame::Write { data }` — the string the user typed on the
//   phone. Also raw UTF-8; keystrokes are text, not binary.
//
// Frames use serde's adjacently-tagged form: `{"op": "…", "body": {…}}`.
// The `body` wrapper (rather than `data`) avoids ugly `"data": {"data":
// "…"}` nesting on `ClientFrame::Write` and `ServerFrame::Bytes`, whose
// inner payloads already carry a `data` field. Field naming inside
// `body` matches the master architecture plan's frame sketches.
//
// typeshare v1 rejects the internally-tagged shape (`#[serde(tag =
// "op")]` alone) — it requires the adjacent form. Cosmetic delta on the
// wire; discriminated-union consumers on the companion side treat both
// the same.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// Frames sent from a mobile client to the desktop server.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", content = "body", rename_all = "snake_case")]
pub enum ClientFrame {
    /// First frame after the WebSocket connection upgrade. Carries the
    /// bearer token the device received during pairing. The WSS server's
    /// auth-stub (next sub-step) reads this and either replies with
    /// `ServerFrame::AuthOk` or `AuthFail` and closes.
    Auth { token: String },

    /// Begin streaming a tab fresh. Server replies with a
    /// `ServerFrame::Snapshot` at the current seq, then a stream of
    /// `ServerFrame::Bytes` frames as new PTY output arrives.
    Subscribe {
        tab_id: String,
        /// How many lines of scrollback to include in the initial
        /// snapshot. The server passes this to the sidecar's serialize
        /// op.
        scrollback: u32,
    },

    /// Reconnect to a previously-subscribed tab. If `last_seq + 1` is
    /// still in the hub's ring buffer, the server replays the missed
    /// bytes; otherwise it sends a fresh snapshot at the current seq
    /// and a new starting counter.
    ///
    /// `last_seq` is a `u64` on the wire but typeshare emits the TS type
    /// as `number` (via `serialized_as`). JavaScript numbers carry 53
    /// bits of integer precision, which is roughly 285 years of
    /// continuous 1 GB/s traffic — well beyond any realistic session
    /// lifetime. The `serialized_as` attribute is typeshare's escape
    /// hatch: typeshare's parser rejects raw `u64` by default; this
    /// tells it to codegen as if the field were `u32` while leaving the
    /// runtime type (and the JSON wire encoding) as `u64`.
    Resume {
        tab_id: String,
        scrollback: u32,
        #[typeshare(serialized_as = "u32")]
        last_seq: u64,
    },

    Unsubscribe { tab_id: String },

    /// User input — text the desktop should write to the PTY. Bracketed
    /// paste wrapping (if any) happens on the desktop side before the
    /// write hits the PTY.
    Write { tab_id: String, data: String },

    Resize { tab_id: String, cols: u16, rows: u16 },

    /// Protocol-level liveness probe. Server replies with
    /// `ServerFrame::Pong`. Runs alongside WebSocket-level pings; this
    /// higher layer catches "socket is fine but the app-level handler
    /// is stuck" cases.
    Ping,
}

/// Frames sent from the desktop server to a mobile client.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", content = "body", rename_all = "snake_case")]
pub enum ServerFrame {
    AuthOk {
        device_name: String,
    },
    AuthFail {
        reason: String,
    },

    /// Project + tab tree push. Sent immediately after `AuthOk` and
    /// again whenever the desktop's tab inventory changes (open, close,
    /// respawn).
    Projects {
        data: Vec<ProjectSummary>,
    },

    /// xterm-serialize output for `tab_id` at seq `seq`. `payload` is a
    /// UTF-8 string of ANSI escape sequences the client replays into a
    /// fresh xterm.js Terminal to restore visual state.
    Snapshot {
        tab_id: String,
        #[typeshare(serialized_as = "u32")]
        seq: u64,
        payload: String,
    },

    /// One chunk of raw PTY output. `data` is base64-encoded because the
    /// bytes are arbitrary binary; the client decodes base64 → bytes
    /// before feeding xterm.js.
    Bytes {
        tab_id: String,
        #[typeshare(serialized_as = "u32")]
        seq: u64,
        data: String,
    },

    Resized {
        tab_id: String,
        cols: u16,
        rows: u16,
    },

    /// Condensed per-tab metadata used for status pills on the mobile
    /// UI. Pushed on subscribe and on any change.
    TabState {
        tab_id: String,
        state: TabStateSummary,
    },

    PtyExit {
        tab_id: String,
    },
    PtyRespawned {
        tab_id: String,
        cwd: String,
    },
    Pong,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub project_id: String,
    pub name: String,
    pub tabs: Vec<TabSummary>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabSummary {
    pub tab_id: String,
    pub label: String,
    pub cwd: Option<String>,
    /// "claude", "codex", or null when no agent is running in this tab.
    pub agent: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabStateSummary {
    pub cwd: Option<String>,
    pub agent: Option<String>,
    pub git_branch: Option<String>,
    pub ports: Vec<u16>,
}
