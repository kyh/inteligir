// ---------------------------------------------------------------------------
// The chat outbox runtime — binds the pure queue (./chat-outbox.ts) to the
// platform: an expo-file-system document for durability, the host bridge for
// delivery, and the shared exponential backoff (@repo/bridge/backoff, the same
// policy the ws reconnect supervisor and the realtime stream use) so a flapping
// connection isn't hammered.
//
// Delivery is serialized — one entry in flight at a time — so the agent
// receives messages in the order they were typed, and every state change is
// written through to disk before the next attempt. A failed attempt goes
// straight back to `pending` and retries; the wire carries the entry's id and
// the host drops a repeat, so retrying can never run a turn twice.
//
// The queue is loaded and drained at MODULE INIT, not on first render: a
// message queued before the app was killed has to leave without the chat
// screen ever being opened. The root layout imports this module for that
// effect.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";

import { createBackoff, timeoutSchedule } from "@repo/bridge/backoff";
import type { Bridge } from "@repo/bridge/ipc-registry";

import { createExternalStore } from "../external-store";
import { createExpoJsonFile } from "../expo-json-file";
import { getHostBridge, getHostSnapshot, subscribeHostStatus } from "../host/connection";
import {
  enqueue,
  nextDispatch,
  parseOutbox,
  remove,
  serializeOutbox,
  withState,
  type Outbox,
  type OutboxEntry,
} from "./chat-outbox";

const OUTBOX_FILE = "chat-outbox.json";

/** What the chat screen renders: the queue, plus whether a queue file had to be
 * set aside because it could not be read. */
export type OutboxView = {
  readonly entries: Outbox;
  readonly unreadable: boolean;
};

const file = createExpoJsonFile(OUTBOX_FILE);
const store = createExternalStore<OutboxView>({ entries: [], unreadable: false });
const backoff = createBackoff({ baseMs: 1_000, capMs: 30_000, schedule: timeoutSchedule });
const delivered = new Set<(text: string) => void>();

/** Id of the entry awaiting its ack, or null. */
let inFlightId: string | null = null;

function entries(): Outbox {
  return store.get().entries;
}

/** Publish + persist. A failed write only costs durability, never the send. */
function setEntries(next: Outbox): void {
  store.set({ entries: next, unreadable: store.get().unreadable });
  try {
    file.write(serializeOutbox(next));
  } catch {
    // Best-effort: the in-memory queue still delivers this session.
  }
}

function load(): void {
  const read = file.read();
  if (read.kind === "absent") return;
  if (read.kind === "text") {
    const stored = parseOutbox(read.text);
    if (stored.kind === "loaded") {
      store.set({ entries: stored.outbox, unreadable: false });
      return;
    }
  }
  // Present but unintelligible. Move the bytes aside before anything writes
  // over them, and say so rather than opening as an empty queue.
  try {
    file.quarantine();
  } catch {
    // Nothing else to try; the report below is still owed to the user.
  }
  store.set({ entries: [], unreadable: true });
}

function drain(): void {
  const bridge = getHostBridge();
  if (bridge === null) return;
  const connected = getHostSnapshot().status === "connected";
  const next = nextDispatch(entries(), { connected, inFlight: inFlightId !== null });
  if (next === null) return;

  inFlightId = next.id;
  setEntries(withState(entries(), next.id, { kind: "sending" }));
  void deliver(bridge, next);
}

async function deliver(bridge: Bridge, entry: OutboxEntry): Promise<void> {
  const acknowledged = await attempt(bridge, entry);
  inFlightId = null;
  if (acknowledged) {
    setEntries(remove(entries(), entry.id));
    for (const listener of delivered) listener(entry.text);
    backoff.reset();
    drain();
    return;
  }
  setEntries(withState(entries(), entry.id, { kind: "pending" }));
  backoff.schedule(drain);
}

/** Hand one entry to the bridge; true once the host acknowledged it. */
async function attempt(bridge: Bridge, entry: OutboxEntry): Promise<boolean> {
  try {
    await bridge.sendAgentCommand({ type: "user_message", text: entry.text, clientId: entry.id });
    return true;
  } catch {
    return false;
  }
}

subscribeHostStatus(() => {
  if (getHostSnapshot().status !== "connected") return;
  // A fresh connection is proof the path works — start the delays over.
  backoff.reset();
  drain();
});

// Boot path: this module is imported for its side effect from the root layout,
// so a throw here would take the whole app down before any screen mounts. A
// queue that cannot be read is worth reporting, never worth failing to launch
// over.
try {
  load();
  drain();
} catch (err) {
  console.warn("[outbox] could not restore the queue at startup:", err);
}

/** Queue one composer submission. Persisted before it is dispatched, so an
 * app kill mid-send leaves a record instead of a lost message. */
export function enqueueChatMessage(text: string): void {
  setEntries(
    enqueue(entries(), {
      id: Crypto.randomUUID(),
      text,
      queuedAt: Date.now(),
      state: { kind: "pending" },
    }),
  );
  drain();
}

/** Called with the text of each message the host acknowledged, so the
 * transcript can show it as sent exactly when it stops being queued. */
export function subscribeDelivered(listener: (text: string) => void): () => void {
  delivered.add(listener);
  return () => {
    delivered.delete(listener);
  };
}

/** Acknowledge the set-aside-queue report; the file itself stays on disk. */
export function dismissUnreadableNotice(): void {
  store.set({ entries: entries(), unreadable: false });
}

/** Subscribe a React component to the queue. */
export function useOutbox(): OutboxView {
  return useSyncExternalStore(store.subscribe, store.get);
}
