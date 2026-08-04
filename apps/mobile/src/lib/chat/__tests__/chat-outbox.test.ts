import { describe, expect, it } from "vitest";

import {
  enqueue,
  nextDispatch,
  parseOutbox,
  remove,
  serializeOutbox,
  shouldDispatch,
  withState,
  type Outbox,
  type OutboxEntry,
  type OutboxState,
} from "../chat-outbox";

function entry(id: string, state: OutboxState = { kind: "pending" }): OutboxEntry {
  return { id, text: `msg ${id}`, queuedAt: 1, state };
}

const CONNECTED = { connected: true, inFlight: false };

describe("shouldDispatch", () => {
  it("dispatches a pending entry over a live, idle connection", () => {
    expect(shouldDispatch({ state: { kind: "pending" }, ...CONNECTED })).toBe(true);
  });

  it("holds everything while disconnected", () => {
    expect(shouldDispatch({ state: { kind: "pending" }, connected: false, inFlight: false })).toBe(
      false,
    );
  });

  it("holds while another entry is awaiting its ack", () => {
    expect(shouldDispatch({ state: { kind: "pending" }, connected: true, inFlight: true })).toBe(
      false,
    );
  });

  it("never re-sends an entry that is already out", () => {
    expect(shouldDispatch({ state: { kind: "sending" }, ...CONNECTED })).toBe(false);
  });
});

describe("nextDispatch", () => {
  it("takes the oldest pending entry, keeping submission order", () => {
    const outbox: Outbox = [entry("a", { kind: "sending" }), entry("b"), entry("c")];
    expect(nextDispatch(outbox, CONNECTED)?.id).toBe("b");
  });

  it("is null when nothing may go", () => {
    expect(nextDispatch([entry("a")], { connected: false, inFlight: false })).toBeNull();
    expect(nextDispatch([], CONNECTED)).toBeNull();
  });
});

describe("queue edits", () => {
  it("enqueue appends, withState replaces, remove drops", () => {
    const one = enqueue([], entry("a"));
    const two = enqueue(one, entry("b"));
    expect(two.map((item) => item.id)).toEqual(["a", "b"]);

    const sending = withState(two, "a", { kind: "sending" });
    expect(sending[0]?.state.kind).toBe("sending");
    expect(sending[1]?.state.kind).toBe("pending");

    expect(remove(sending, "a").map((item) => item.id)).toEqual(["b"]);
  });
});

describe("persistence", () => {
  it("round-trips the queue", () => {
    const outbox: Outbox = [entry("a"), entry("b")];
    expect(parseOutbox(serializeOutbox(outbox))).toEqual({ kind: "loaded", outbox });
  });

  it("re-arms an interrupted send rather than stranding it", () => {
    const stored = serializeOutbox([entry("a", { kind: "sending" })]);
    expect(parseOutbox(stored)).toEqual({ kind: "loaded", outbox: [entry("a")] });
  });

  it("reports a corrupt or foreign file as unreadable, never as an empty queue", () => {
    expect(parseOutbox("{not json")).toEqual({ kind: "unreadable" });
    expect(parseOutbox("")).toEqual({ kind: "unreadable" });
    expect(parseOutbox(JSON.stringify({ version: 99, entries: [entry("a")] }))).toEqual({
      kind: "unreadable",
    });
  });

  it("refuses the whole file rather than silently dropping one bad entry", () => {
    const stored = JSON.stringify({ version: 2, entries: [{ id: "x" }, entry("a")] });
    expect(parseOutbox(stored)).toEqual({ kind: "unreadable" });
  });
});
