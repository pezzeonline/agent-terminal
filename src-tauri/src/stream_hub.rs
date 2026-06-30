// Per-tab fan-out of PTY output. The reader thread broadcasts every chunk
// through here instead of sending directly to the WebView Channel; the hub
// then delivers to every subscriber (local WebView + future remote mobile
// clients) AND writes the same bytes to the sidecar's shadow xterm so the
// sidecar's terminal state stays in sync with the real PTY for the upcoming
// `serialize` op.
//
// What the hub owns per tab:
// - A monotonic u64 sequence counter for every broadcast chunk.
// - A bytes-capped ring buffer of recent (seq, bytes) entries — used for
//   replay-on-reconnect to remote clients (no consumers yet; sub-step 4
//   wires this up).
// - A list of subscribers. In this sub-step only `Subscriber::Local` exists;
//   `Subscriber::Remote` arrives when the WSS server lands.
// - Last-known cols/rows so future `subscribe_remote` calls know what size
//   to ask the sidecar to serialise.
//
// What the hub does NOT own:
// - The PTY itself (lives in `PtyHandle` inside `PtyMap`).
// - The UTF-8 stream decoder (lives in the reader thread, kept there so the
//   stateful cross-chunk decode stays single-threaded and identical to
//   today's byte-for-byte behaviour).
// - The mod engine. `pty_manager` still feeds `mod_handle.on_output` with
//   raw bytes directly — the hub is purely a forwarder.
//
// Locking discipline (matters for reasoning about deadlocks):
// - `tabs` is a DashMap (sharded). Holding a per-tab `Arc<TabState>` does
//   not block other tabs.
// - Within a tab, the order is always: `subscribers` lock first, then
//   `shared.lock()` on a Local subscriber's channel. No code path goes the
//   other way, so there is no AB / BA deadlock between hub broadcast and
//   `try_reattach`'s channel swap.

use crate::pty_manager::{PtyDataPayload, SharedChannel};
use crate::sidecar_client::SidecarClient;
use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};

/// Default ring buffer cap per tab — bytes, not entries. Holds roughly five
/// to ten seconds of continuous high-bandwidth output. Past this point a
/// reconnecting remote client receives a fresh snapshot instead of byte
/// replay (sub-step 4 implements the snapshot path).
pub const DEFAULT_RING_CAP_BYTES: usize = 512 * 1024;

/// Stable identifier for a subscriber within a tab. Allocated by the hub
/// at subscribe time; callers hand it back to unsubscribe. Opaque on
/// purpose — the underlying counter is an implementation detail.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SubscriberId(u64);

/// Per-tab fan-out target. `#[non_exhaustive]` so adding the upcoming
/// `Remote` variant for paired mobile clients does not break any external
/// matcher — and matches the intent expressed in the master architecture
/// plan that subscribers grow over the phases.
#[non_exhaustive]
pub enum Subscriber {
    /// Desktop WebView path. The SharedChannel inside flips between
    /// `Some(channel)` and `None` as the WebView connects and reconnects
    /// without ever re-subscribing — same shape pty_manager has used since
    /// before the hub existed.
    Local(SharedChannel),
}

struct TabState {
    next_seq: AtomicU64,
    ring: Mutex<RingBuffer>,
    subscribers: Mutex<Vec<(SubscriberId, Subscriber)>>,
    next_sub_id: AtomicU64,
    // Last-known terminal size. `resize_tab` updates this; future
    // `subscribe_remote` will read it to know what dimensions to ask the
    // sidecar to serialise.
    cols: AtomicU16,
    rows: AtomicU16,
}

impl TabState {
    fn new(cols: u16, rows: u16, ring_cap_bytes: usize) -> Self {
        Self {
            next_seq: AtomicU64::new(0),
            ring: Mutex::new(RingBuffer::new(ring_cap_bytes)),
            subscribers: Mutex::new(Vec::new()),
            next_sub_id: AtomicU64::new(1),
            cols: AtomicU16::new(cols),
            rows: AtomicU16::new(rows),
        }
    }
}

struct RingBuffer {
    cap_bytes: usize,
    bytes_held: usize,
    entries: VecDeque<(u64, Vec<u8>)>,
}

impl RingBuffer {
    fn new(cap_bytes: usize) -> Self {
        Self {
            cap_bytes,
            bytes_held: 0,
            entries: VecDeque::new(),
        }
    }

    /// Append a new chunk, evicting older ones from the front until the
    /// held byte total fits the cap. The newest entry is always kept even
    /// if it alone exceeds the cap — losing it would silently drop bytes
    /// the producer just claimed to broadcast.
    fn push(&mut self, seq: u64, bytes: Vec<u8>) {
        self.bytes_held = self.bytes_held.saturating_add(bytes.len());
        self.entries.push_back((seq, bytes));
        while self.bytes_held > self.cap_bytes && self.entries.len() > 1 {
            if let Some((_, evicted)) = self.entries.pop_front() {
                self.bytes_held = self.bytes_held.saturating_sub(evicted.len());
            }
        }
    }
}

pub struct StreamHub {
    tabs: DashMap<String, Arc<TabState>>,
    sidecar: Option<Arc<SidecarClient>>,
    ring_cap_bytes: usize,
}

impl StreamHub {
    pub fn new(sidecar: Option<Arc<SidecarClient>>) -> Arc<Self> {
        Self::with_ring_cap(sidecar, DEFAULT_RING_CAP_BYTES)
    }

    pub fn with_ring_cap(sidecar: Option<Arc<SidecarClient>>, ring_cap_bytes: usize) -> Arc<Self> {
        Arc::new(Self {
            tabs: DashMap::new(),
            sidecar,
            ring_cap_bytes,
        })
    }

    /// Create per-tab state (idempotent) and tell the sidecar to open a
    /// matching headless xterm. Fully synchronous — the sidecar `open`
    /// line lands on the writer mpsc before this call returns, so any
    /// subsequent `broadcast` from the same thread is guaranteed to push
    /// its `write` line after the `open`. The previous version spawned
    /// the open as a tokio task, which broke that ordering whenever the
    /// reader thread raced ahead of the runtime scheduler.
    pub fn ensure_tab(&self, tab_id: &str, cols: u16, rows: u16) {
        self.tabs
            .entry(tab_id.to_string())
            .or_insert_with(|| Arc::new(TabState::new(cols, rows, self.ring_cap_bytes)));

        if let Some(sidecar) = self.sidecar.as_ref() {
            sidecar.open_nonblocking(tab_id, cols, rows);
        }
    }

    /// Add a Local subscriber for `tab_id`. Caller stores the returned id
    /// and passes it to `unsubscribe` later. If the tab doesn't exist yet
    /// (broadcast hasn't happened), it is created with default 80x24
    /// dimensions; the upcoming resize call will correct them.
    pub fn subscribe_local(&self, tab_id: &str, channel: SharedChannel) -> SubscriberId {
        let state = self
            .tabs
            .entry(tab_id.to_string())
            .or_insert_with(|| Arc::new(TabState::new(80, 24, self.ring_cap_bytes)))
            .clone();
        let id = SubscriberId(state.next_sub_id.fetch_add(1, Ordering::Relaxed));
        state
            .subscribers
            .lock()
            .expect("subscribers lock poisoned")
            .push((id, Subscriber::Local(channel)));
        id
    }

    pub fn unsubscribe(&self, tab_id: &str, sub_id: SubscriberId) {
        if let Some(state) = self.tabs.get(tab_id) {
            state
                .subscribers
                .lock()
                .expect("subscribers lock poisoned")
                .retain(|(id, _)| *id != sub_id);
        }
    }

    /// Broadcast one chunk of PTY output. Local subscribers receive the
    /// UTF-8 decoded string (matches the `PtyDataPayload { data: String }`
    /// shape the WebView already consumes). The ring buffer and the
    /// sidecar receive the raw bytes (xterm-headless parses escape
    /// sequences from bytes; the ring's replay path needs raw too).
    ///
    /// Caller passes both raw and decoded because the stateful UTF-8
    /// decoder lives in the reader thread — moving it into the hub would
    /// require synchronising the decoder across hypothetical concurrent
    /// broadcasts to the same tab, which today never happens (one reader
    /// thread per tab) but would be a footgun for future contributors.
    ///
    /// Sync (not async) so the reader thread's hot loop stays on a real
    /// OS thread without bouncing off the tokio runtime.
    pub fn broadcast(&self, tab_id: &str, raw_bytes: &[u8], decoded_str: &str) {
        if raw_bytes.is_empty() && decoded_str.is_empty() {
            return;
        }
        let state = match self.tabs.get(tab_id) {
            Some(s) => Arc::clone(&s),
            None => return,
        };

        if !decoded_str.is_empty() {
            let subscribers = state.subscribers.lock().expect("subscribers lock poisoned");
            for (_, sub) in subscribers.iter() {
                match sub {
                    Subscriber::Local(shared) => {
                        let send_failed = {
                            let guard = shared.lock().expect("channel lock poisoned");
                            match guard.as_ref() {
                                Some(ch) => ch
                                    .send(PtyDataPayload {
                                        data: decoded_str.to_string(),
                                    })
                                    .is_err(),
                                // WebView disconnected; the next `open_tab`
                                // call will swap a fresh Channel into this
                                // SharedChannel. Skip without fault.
                                None => false,
                            }
                        };
                        if send_failed {
                            // Channel dropped mid-send (WebView vanished
                            // while we were forwarding). Clear so the next
                            // broadcast skips cleanly. Matches the
                            // pre-hub behaviour byte-for-byte.
                            shared
                                .lock()
                                .expect("channel lock poisoned")
                                .take();
                        }
                    }
                }
            }
        }

        if !raw_bytes.is_empty() {
            let seq = state.next_seq.fetch_add(1, Ordering::AcqRel);
            state
                .ring
                .lock()
                .expect("ring lock poisoned")
                .push(seq, raw_bytes.to_vec());
            if let Some(sidecar) = &self.sidecar {
                sidecar.write_bytes(tab_id, raw_bytes);
            }
        }
    }

    /// Update the tab's known size and tell the sidecar to resize its
    /// shadow xterm. Sync + fire-and-forget so callers don't have to be
    /// async just to drag a divider.
    pub fn resize_tab(&self, tab_id: &str, cols: u16, rows: u16) {
        if let Some(state) = self.tabs.get(tab_id) {
            state.cols.store(cols, Ordering::Release);
            state.rows.store(rows, Ordering::Release);
        }
        if let Some(sidecar) = self.sidecar.as_ref() {
            sidecar.resize_nonblocking(tab_id, cols, rows);
        }
    }

    /// Drop per-tab state and tell the sidecar to dispose its shadow.
    /// Sync + fire-and-forget. Called both from the user-facing close_tab
    /// command and from spawn_pty when restarting a tab whose previous
    /// PTY died (resets ring + seq + sidecar shadow so the new session
    /// doesn't inherit stale state).
    pub fn close_tab(&self, tab_id: &str) {
        self.tabs.remove(tab_id);
        if let Some(sidecar) = self.sidecar.as_ref() {
            sidecar.close_nonblocking(tab_id);
        }
    }

    // ---- introspection — used by tests and by future remote ops ----

    /// Read the current seq counter for a tab. Returns None if the tab is
    /// unknown. Mostly a test affordance today; future `subscribe_remote`
    /// will use it to stamp the snapshot frame.
    pub fn next_seq(&self, tab_id: &str) -> Option<u64> {
        self.tabs
            .get(tab_id)
            .map(|s| s.next_seq.load(Ordering::Acquire))
    }

    /// Snapshot of the current ring contents. Test affordance + future
    /// resume-remote path. Returns a clone so callers don't hold the lock.
    pub fn ring_entries(&self, tab_id: &str) -> Option<Vec<(u64, Vec<u8>)>> {
        self.tabs.get(tab_id).map(|s| {
            s.ring
                .lock()
                .expect("ring lock poisoned")
                .entries
                .iter()
                .cloned()
                .collect()
        })
    }

    /// Aggregate bytes currently held in the ring for `tab_id`.
    pub fn ring_bytes_held(&self, tab_id: &str) -> Option<usize> {
        self.tabs.get(tab_id).map(|s| {
            s.ring
                .lock()
                .expect("ring lock poisoned")
                .bytes_held
        })
    }

    /// Number of subscribers currently registered for `tab_id`.
    pub fn subscriber_count(&self, tab_id: &str) -> Option<usize> {
        self.tabs
            .get(tab_id)
            .map(|s| s.subscribers.lock().expect("subscribers lock poisoned").len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_hub() -> Arc<StreamHub> {
        StreamHub::new(None)
    }

    fn new_hub_with_cap(cap: usize) -> Arc<StreamHub> {
        StreamHub::with_ring_cap(None, cap)
    }

    #[test]
    fn ensure_tab_creates_state_at_zero_seq() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.subscriber_count("t1"), Some(0));
    }

    #[test]
    fn ensure_tab_is_idempotent() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"a", "a");
        // Re-ensuring must not reset seq or wipe state.
        hub.ensure_tab("t1", 120, 30);
        assert_eq!(hub.next_seq("t1"), Some(1));
    }

    #[test]
    fn broadcast_increments_seq_per_chunk() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        for _ in 0..5 {
            hub.broadcast("t1", b"x", "x");
        }
        assert_eq!(hub.next_seq("t1"), Some(5));
    }

    #[test]
    fn broadcast_pushes_raw_bytes_to_ring() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"hello", "hello");
        let entries = hub.ring_entries("t1").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, 0);
        assert_eq!(entries[0].1, b"hello");
    }

    #[test]
    fn ring_evicts_oldest_when_over_cap() {
        // Tiny cap so eviction kicks in after a few writes.
        let hub = new_hub_with_cap(100);
        hub.ensure_tab("t1", 80, 24);
        for i in 0..10u8 {
            hub.broadcast("t1", &[i; 20], "x");
        }
        let entries = hub.ring_entries("t1").unwrap();
        let total: usize = entries.iter().map(|(_, b)| b.len()).sum();
        assert!(total <= 100, "ring exceeded cap: {total}");
        // Newest entry must still be present — losing it would mean
        // dropping bytes the caller just claimed to broadcast.
        assert_eq!(entries.last().unwrap().0, 9);
        // Oldest entries should have been evicted.
        assert!(entries.first().unwrap().0 >= 5);
    }

    #[test]
    fn ring_keeps_single_oversize_entry() {
        let hub = new_hub_with_cap(50);
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", &vec![0u8; 500], "x");
        let entries = hub.ring_entries("t1").unwrap();
        assert_eq!(entries.len(), 1, "must not silently drop the only entry");
        assert_eq!(entries[0].1.len(), 500);
    }

    #[test]
    fn separate_tabs_have_independent_seqs() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.ensure_tab("t2", 80, 24);
        hub.broadcast("t1", b"a", "a");
        hub.broadcast("t1", b"b", "b");
        hub.broadcast("t2", b"x", "x");
        assert_eq!(hub.next_seq("t1"), Some(2));
        assert_eq!(hub.next_seq("t2"), Some(1));
    }

    #[test]
    fn broadcast_to_unknown_tab_is_silent() {
        let hub = new_hub();
        hub.broadcast("ghost", b"x", "x");
        assert_eq!(hub.next_seq("ghost"), None);
    }

    #[test]
    fn empty_broadcast_is_noop() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"", "");
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 0);
    }

    #[test]
    fn decoded_only_broadcast_skips_ring() {
        // Simulates the reader-thread EOF flush: decoder spits out a
        // partial-codepoint tail, raw bytes are empty.
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"", "tail");
        // No raw bytes → no ring entry, no seq increment, no sidecar
        // (verified indirectly by ring + seq state).
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 0);
    }

    #[test]
    fn close_tab_drops_state() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"hello", "hello");
        hub.close_tab("t1");
        assert_eq!(hub.next_seq("t1"), None);
        assert!(hub.ring_entries("t1").is_none());
    }

    /// Regression: when `spawn_pty` restarts a tab whose previous PTY
    /// expired, it calls `close_tab` then `ensure_tab` on the same id.
    /// The hub state must come up fresh — same seq counter as a brand-
    /// new tab, empty ring, no carried-over subscribers — otherwise
    /// remote subscribers' resume-by-seq math is wrong on the next
    /// session.
    #[test]
    fn close_then_ensure_resets_seq_ring_and_subscribers() {
        let hub = new_hub();
        let make_chan = || Arc::new(Mutex::new(None));

        // First session.
        hub.ensure_tab("t1", 80, 24);
        let _id = hub.subscribe_local("t1", make_chan());
        hub.broadcast("t1", b"first-session-bytes", "x");
        assert_eq!(hub.next_seq("t1"), Some(1));
        assert_eq!(hub.subscriber_count("t1"), Some(1));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 1);

        // Simulated respawn-after-expiry path.
        hub.close_tab("t1");
        hub.ensure_tab("t1", 80, 24);

        // Fresh state: seq back to zero, no subscribers, empty ring.
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.subscriber_count("t1"), Some(0));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 0);

        // A new subscriber attaches cleanly and its broadcasts are
        // accounted against the fresh seq counter.
        hub.subscribe_local("t1", make_chan());
        hub.broadcast("t1", b"second-session", "x");
        assert_eq!(hub.next_seq("t1"), Some(1));
    }

    #[test]
    fn subscribe_local_returns_distinct_ids() {
        let hub = new_hub();
        let make_chan = || Arc::new(Mutex::new(None));
        let id1 = hub.subscribe_local("t1", make_chan());
        let id2 = hub.subscribe_local("t1", make_chan());
        let id3 = hub.subscribe_local("t1", make_chan());
        assert_ne!(id1, id2);
        assert_ne!(id2, id3);
        assert_eq!(hub.subscriber_count("t1"), Some(3));
    }

    #[test]
    fn unsubscribe_removes_only_named_subscriber() {
        let hub = new_hub();
        let make_chan = || Arc::new(Mutex::new(None));
        let id1 = hub.subscribe_local("t1", make_chan());
        let _id2 = hub.subscribe_local("t1", make_chan());
        assert_eq!(hub.subscriber_count("t1"), Some(2));
        hub.unsubscribe("t1", id1);
        assert_eq!(hub.subscriber_count("t1"), Some(1));
    }

    #[test]
    fn unsubscribe_unknown_tab_is_silent() {
        let hub = new_hub();
        hub.unsubscribe("ghost", SubscriberId(99));
        // No panic; nothing to verify beyond "didn't crash".
    }

    /// Stress: many threads broadcasting into different tabs hammer the
    /// DashMap shards. The hub must remain consistent: each tab's seq
    /// counter equals the number of broadcasts that hit it.
    #[test]
    fn concurrent_broadcasts_across_tabs_consistent() {
        let hub = new_hub();
        for t in 0..16 {
            hub.ensure_tab(&format!("t{t}"), 80, 24);
        }
        let handles: Vec<_> = (0..16)
            .map(|t| {
                let hub = Arc::clone(&hub);
                std::thread::spawn(move || {
                    for _ in 0..1000 {
                        hub.broadcast(&format!("t{t}"), b"x", "x");
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        for t in 0..16 {
            assert_eq!(hub.next_seq(&format!("t{t}")), Some(1000));
        }
    }
}
