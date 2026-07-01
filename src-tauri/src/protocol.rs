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

// Optional fields on the summary structs use
// `#[serde(skip_serializing_if = "Option::is_none")]` so absent values are
// OMITTED from the JSON rather than serialised as `null`. The generated TS
// types are `cwd?: string` (i.e. `string | undefined`) — a wire-level
// `null` would violate that contract and could crash a client that
// assumes the field is either a string or absent. Serde's default is
// asymmetric on purpose: we still accept `{"cwd": null}` on the way in
// (Option deserialization tolerates both), so mobile bugs on the emitter
// side don't break us.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabSummary {
    pub tab_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// "claude", "codex", or absent when no agent is running in this tab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabStateSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    pub ports: Vec<u16>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    /// Every ClientFrame variant round-trips through JSON unchanged.
    /// Catches derive-macro mistakes (forgotten Serialize/Deserialize,
    /// mis-written serde tag/content attributes) and locks the wire
    /// format so a casual refactor cannot silently alter the bytes.
    #[test]
    fn client_frame_roundtrip_every_variant() {
        let cases: Vec<ClientFrame> = vec![
            ClientFrame::Auth { token: "abc".into() },
            ClientFrame::Subscribe {
                tab_id: "t1".into(),
                scrollback: 500,
            },
            ClientFrame::Resume {
                tab_id: "t1".into(),
                scrollback: 500,
                last_seq: 12345,
            },
            ClientFrame::Unsubscribe {
                tab_id: "t1".into(),
            },
            ClientFrame::Write {
                tab_id: "t1".into(),
                data: "ls -la\r".into(),
            },
            ClientFrame::Resize {
                tab_id: "t1".into(),
                cols: 132,
                rows: 40,
            },
            ClientFrame::Ping,
        ];
        for case in cases {
            let s = serde_json::to_string(&case).expect("encode");
            let back: ClientFrame = serde_json::from_str(&s).expect("decode");
            let a = serde_json::to_value(&case).unwrap();
            let b = serde_json::to_value(&back).unwrap();
            assert_eq!(a, b, "roundtrip diverged for {s}");
        }
    }

    /// Every ServerFrame variant round-trips too.
    #[test]
    fn server_frame_roundtrip_every_variant() {
        let cases: Vec<ServerFrame> = vec![
            ServerFrame::AuthOk {
                device_name: "iPhone".into(),
            },
            ServerFrame::AuthFail {
                reason: "bad token".into(),
            },
            ServerFrame::Projects {
                data: vec![ProjectSummary {
                    project_id: "p1".into(),
                    name: "control-center".into(),
                    tabs: vec![TabSummary {
                        tab_id: "t1".into(),
                        label: "dev".into(),
                        cwd: Some("/tmp".into()),
                        agent: Some("claude".into()),
                    }],
                }],
            },
            ServerFrame::Snapshot {
                tab_id: "t1".into(),
                seq: 12500,
                payload: "\x1b[H\x1b[2J".into(),
            },
            ServerFrame::Bytes {
                tab_id: "t1".into(),
                seq: 12501,
                data: "aGVsbG8=".into(),
            },
            ServerFrame::Resized {
                tab_id: "t1".into(),
                cols: 132,
                rows: 40,
            },
            ServerFrame::TabState {
                tab_id: "t1".into(),
                state: TabStateSummary {
                    cwd: Some("/tmp".into()),
                    agent: None,
                    git_branch: Some("main".into()),
                    ports: vec![3000, 5173],
                },
            },
            ServerFrame::PtyExit {
                tab_id: "t1".into(),
            },
            ServerFrame::PtyRespawned {
                tab_id: "t1".into(),
                cwd: "/tmp".into(),
            },
            ServerFrame::Pong,
        ];
        for case in cases {
            let s = serde_json::to_string(&case).expect("encode");
            let back: ServerFrame = serde_json::from_str(&s).expect("decode");
            let a = serde_json::to_value(&case).unwrap();
            let b = serde_json::to_value(&back).unwrap();
            assert_eq!(a, b, "roundtrip diverged for {s}");
        }
    }

    // The fixture tests below pin the exact JSON shape — the load-bearing
    // guarantee that lets the mobile side read a bytes[] on the wire
    // without hand-rolling parsing that could drift from serde's output.
    // If any of these fail, the wire format changed and the mobile client
    // needs a coordinated update.

    #[test]
    fn client_auth_wire_shape() {
        let frame = ClientFrame::Auth {
            token: "dev-token".into(),
        };
        assert_eq!(
            serde_json::to_value(&frame).unwrap(),
            json!({ "op": "auth", "body": { "token": "dev-token" } })
        );
    }

    #[test]
    fn client_subscribe_wire_shape() {
        let frame = ClientFrame::Subscribe {
            tab_id: "claude-ui:dev".into(),
            scrollback: 500,
        };
        assert_eq!(
            serde_json::to_value(&frame).unwrap(),
            json!({
                "op": "subscribe",
                "body": { "tab_id": "claude-ui:dev", "scrollback": 500 }
            })
        );
    }

    #[test]
    fn client_resume_wire_shape_carries_u64_last_seq() {
        let frame = ClientFrame::Resume {
            tab_id: "t1".into(),
            scrollback: 500,
            last_seq: 1_234_567_890,
        };
        assert_eq!(
            serde_json::to_value(&frame).unwrap(),
            json!({
                "op": "resume",
                "body": {
                    "tab_id": "t1",
                    "scrollback": 500,
                    "last_seq": 1_234_567_890u64
                }
            })
        );
    }

    #[test]
    fn client_write_wire_shape() {
        // Regression pin for the `body`-vs-`data` decision: the outer
        // wrapper is `body` and the inner variant field stays `data`.
        // If the wrapper accidentally reverts to `data`, this test names
        // the fix.
        let frame = ClientFrame::Write {
            tab_id: "t1".into(),
            data: "echo hi\r".into(),
        };
        let value = serde_json::to_value(&frame).unwrap();
        assert_eq!(value["op"], "write");
        assert_eq!(value["body"]["tab_id"], "t1");
        assert_eq!(value["body"]["data"], "echo hi\r");
    }

    #[test]
    fn client_ping_wire_shape_omits_body() {
        // Unit variants serialise with no body field (serde adjacent-
        // tagging behaviour). typeshare mirrors this on the TS side as
        // `body?: undefined`.
        let frame = ClientFrame::Ping;
        assert_eq!(
            serde_json::to_value(&frame).unwrap(),
            json!({ "op": "ping" })
        );
    }

    #[test]
    fn server_bytes_wire_shape() {
        let frame = ServerFrame::Bytes {
            tab_id: "t1".into(),
            seq: 42,
            data: "aGVsbG8gd29ybGQ=".into(),
        };
        assert_eq!(
            serde_json::to_value(&frame).unwrap(),
            json!({
                "op": "bytes",
                "body": {
                    "tab_id": "t1",
                    "seq": 42,
                    "data": "aGVsbG8gd29ybGQ="
                }
            })
        );
    }

    #[test]
    fn server_projects_wire_shape() {
        let frame = ServerFrame::Projects {
            data: vec![ProjectSummary {
                project_id: "p1".into(),
                name: "proj".into(),
                tabs: vec![],
            }],
        };
        assert_eq!(
            serde_json::to_value(&frame).unwrap(),
            json!({
                "op": "projects",
                "body": {
                    "data": [
                        {
                            "project_id": "p1",
                            "name": "proj",
                            "tabs": []
                        }
                    ]
                }
            })
        );
    }

    #[test]
    fn optional_fields_omit_when_absent() {
        // TabStateSummary carries `#[serde(skip_serializing_if =
        // "Option::is_none")]` on every Option<String> field. `None`
        // must OMIT the key entirely, not emit `null` — the TS side
        // types these as `cwd?: string` (i.e. `string | undefined`);
        // a wire-level `null` would violate the generated contract.
        let s = TabStateSummary {
            cwd: None,
            agent: None,
            git_branch: None,
            ports: vec![],
        };
        assert_eq!(
            serde_json::to_value(&s).unwrap(),
            json!({ "ports": [] })
        );
    }

    #[test]
    fn optional_fields_present_when_some() {
        // Positive-path fixture: `Some(x)` serialises to the value
        // directly (no wrapper). Paired with the omit-when-absent
        // fixture above, both directions of the encoding are locked.
        let s = TabStateSummary {
            cwd: Some("/tmp".into()),
            agent: Some("claude".into()),
            git_branch: Some("main".into()),
            ports: vec![3000],
        };
        assert_eq!(
            serde_json::to_value(&s).unwrap(),
            json!({
                "cwd": "/tmp",
                "agent": "claude",
                "git_branch": "main",
                "ports": [3000]
            })
        );
    }

    #[test]
    fn optional_fields_accept_null_on_deserialize() {
        // The asymmetric-tolerance side of the same design: we OMIT on
        // the way out but accept `null` on the way in. A misbehaved
        // mobile client that emits `{"cwd": null, ...}` still parses
        // cleanly into a `TabStateSummary` with `cwd: None`.
        let raw = json!({
            "cwd": null,
            "agent": null,
            "git_branch": null,
            "ports": []
        });
        let s: TabStateSummary = serde_json::from_value(raw).expect("decode");
        assert!(s.cwd.is_none());
        assert!(s.agent.is_none());
        assert!(s.git_branch.is_none());
        assert!(s.ports.is_empty());
    }
}
