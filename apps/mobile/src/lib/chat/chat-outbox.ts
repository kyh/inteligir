// ---------------------------------------------------------------------------
// The chat outbox — the durable queue behind the mobile composer. The
// connection owner drops the bridge when the app backgrounds (host/
// connection-core.ts), and that path rejects everything queued or in flight;
// phones background constantly, so a send used to vanish with no retry, no
// record and no error the user ever saw.
//
// So a submission is MINTED and PERSISTED before it is handed to any bridge,
// and it only leaves the queue when the host acknowledged it. The id is the
// entry's identity across an app kill, and it also rides the wire: the host
// drops a command whose clientId it already delivered
// (server/app/agent-gateway.ts). THAT is what makes every failure the same
// failure — a send whose outcome is unknown simply goes back to `pending` and
// retries itself, because a duplicate turn is no longer possible. Nothing here
// ever asks the user to decide whether their own message went through.
//
// An entry carries TEXT ONLY, never a command kind. `follow_up` does not start
// a turn — pi delivers it at a turn boundary — so a kind frozen at submission
// and dispatched minutes later can land as a follow-up on an idle agent and sit
// in the queue forever. The host decides live at dispatch time instead
// (PiAgent.sendMessage routes to followUp while the session is busy).
//
// PURE: the model, the parse/serialize, and the delivery decision, all over
// plain values with no expo/react imports, so they unit-test on node. The
// storage + bridge + backoff wiring is ./outbox.ts.
// ---------------------------------------------------------------------------

export type OutboxState =
  /** Not currently with a bridge — freshly queued, restored from disk, or
   * back from a failed attempt. The only state that dispatches. */
  | { readonly kind: "pending" }
  /** Handed to a live bridge, awaiting the ack. */
  | { readonly kind: "sending" };

export type OutboxEntry = {
  /** Client-minted, persisted before dispatch, sent as the wire's `clientId`;
   * stable across retries so the host can drop the repeat. */
  readonly id: string;
  readonly text: string;
  /** Epoch ms at submission — the queue's order. */
  readonly queuedAt: number;
  readonly state: OutboxState;
};

export type Outbox = readonly OutboxEntry[];

/** What a persisted queue file yielded. `unreadable` is NOT an empty queue:
 * bytes are there and could not be understood, which the caller must preserve
 * and report rather than silently start over from nothing. */
export type StoredOutbox =
  | { readonly kind: "loaded"; readonly outbox: Outbox }
  | { readonly kind: "unreadable" };

/** The persisted file's shape; bumped if the entry shape ever changes. */
const OUTBOX_VERSION = 2;

export function enqueue(outbox: Outbox, entry: OutboxEntry): Outbox {
  return [...outbox, entry];
}

/** Replace one entry's state (no-op for an id that already left the queue). */
export function withState(outbox: Outbox, id: string, state: OutboxState): Outbox {
  return outbox.map((entry) => (entry.id === id ? { ...entry, state } : entry));
}

export function remove(outbox: Outbox, id: string): Outbox {
  return outbox.filter((entry) => entry.id !== id);
}

/**
 * The delivery decision for ONE entry, over the tuple that decides it. Sends
 * are serialized (`inFlight`) so the agent receives them in the order the user
 * typed them.
 */
export function shouldDispatch(input: {
  readonly state: OutboxState;
  readonly connected: boolean;
  /** True while another entry is already awaiting its ack. */
  readonly inFlight: boolean;
}): boolean {
  if (!input.connected || input.inFlight) return false;
  return input.state.kind === "pending";
}

/** The next entry to hand to the bridge, or null when nothing may go now. */
export function nextDispatch(
  outbox: Outbox,
  context: { readonly connected: boolean; readonly inFlight: boolean },
): OutboxEntry | null {
  return (
    outbox.find((entry) =>
      shouldDispatch({
        state: entry.state,
        connected: context.connected,
        inFlight: context.inFlight,
      }),
    ) ?? null
  );
}

function isEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "string" || value.id === "") return false;
  if (!("text" in value) || typeof value.text !== "string") return false;
  if (!("queuedAt" in value) || typeof value.queuedAt !== "number") return false;
  if (!("state" in value) || typeof value.state !== "object" || value.state === null) return false;
  const kind = "kind" in value.state ? value.state.kind : null;
  return kind === "pending" || kind === "sending";
}

/**
 * Restore the queue from its persisted text. A `sending` entry becomes
 * `pending`: the process died mid-request, and re-sending is safe because the
 * host drops the repeat by clientId. Anything the shape check refuses makes
 * the WHOLE file unreadable rather than a partial queue — a dropped entry is a
 * message the user typed, and losing it quietly is the bug this module exists
 * to close.
 */
export function parseOutbox(text: string): StoredOutbox {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "unreadable" };
  if (!("version" in parsed) || parsed.version !== OUTBOX_VERSION) return { kind: "unreadable" };
  if (!("entries" in parsed) || !Array.isArray(parsed.entries)) return { kind: "unreadable" };
  const entries: OutboxEntry[] = [];
  for (const candidate of parsed.entries) {
    if (!isEntry(candidate)) return { kind: "unreadable" };
    entries.push(
      candidate.state.kind === "sending" ? { ...candidate, state: { kind: "pending" } } : candidate,
    );
  }
  return { kind: "loaded", outbox: entries };
}

export function serializeOutbox(outbox: Outbox): string {
  return JSON.stringify({ version: OUTBOX_VERSION, entries: outbox });
}
