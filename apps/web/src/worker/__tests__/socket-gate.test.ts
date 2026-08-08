// ---------------------------------------------------------------------------
// The capability gate, driven through the thing that enforces it.
//
// The predicates themselves (mayInvoke/mayReceive) are pure and asserted in
// host-handlers.test.ts. What this suite covers is the half that can actually
// fail open: whether the OUTBOUND direction consults them at all. Every byte
// this host pushes a client unasked — a broadcast, and the reconnect hydration
// that resolves a getter host-side — goes through `SocketGate`, so the socket
// is faked and what arrived on it is the assertion.
//
// Invert `mayReceive` and this file turns red.
// ---------------------------------------------------------------------------

import { REMOTE_ALLOWED_EVENTS } from "@repo/bridge/channel-policy";
import { parseServerFrame } from "@repo/bridge/ws-protocol";
import { describe, expect, it } from "vitest";

import type { ClientClass } from "../host/client-class";
import type { WireHandler } from "../host/handler-registry";
import { SocketGate, type GateSocket } from "../host/socket-gate";
import { authedState, pendingState } from "../host/socket-state";

/** A socket that records what it was sent — the whole of what the gate needs
 * (its attachment, its ready state, one write). */
function fakeSocket(attachment: unknown, readyState = WebSocket.READY_STATE_OPEN) {
  const sent: Array<string | ArrayBufferView> = [];
  return {
    readyState,
    send: (frame: string | ArrayBufferView) => {
      sent.push(frame);
    },
    deserializeAttachment: () => attachment,
    /** The event methods this socket actually received, in order. */
    events: (): string[] =>
      sent.flatMap((frame) => {
        if (typeof frame !== "string") return [];
        const parsed = parseServerFrame(frame);
        return parsed !== null && parsed.t === "evt" ? [parsed.method] : [];
      }),
    binaryFrames: (): ArrayBufferView[] => sent.filter((frame) => typeof frame !== "string"),
  };
}

function socketFor(clientClass: ClientClass, readyState?: number) {
  return fakeSocket(authedState(clientClass, Date.now()), readyState);
}

/** The hydration getters, plus one method neither class may ever reach, each
 * recording that it ran — so a withheld event can be told apart from a
 * withheld READ. */
function handlersRecording(calls: string[]): Record<string, WireHandler> {
  const record =
    (method: string): WireHandler =>
    () => {
      calls.push(method);
      return { answered: method };
    };
  return {
    getAppState: record("getAppState"),
    listDelegations: record("listDelegations"),
    listRoutines: record("listRoutines"),
    getAiProviderSettings: record("getAiProviderSettings"),
    getUiState: record("getUiState"),
  };
}

function gateOver(sockets: GateSocket[], handlers: Record<string, WireHandler> = {}): SocketGate {
  return new SocketGate({ handlers, sockets: () => sockets });
}

describe("what a socket may ask", () => {
  it("resolves a method for the class that holds it", () => {
    const gate = gateOver([], handlersRecording([]));
    const resolved = gate.resolve(authedState("web", 0), "getUiState");
    expect(resolved.ok).toBe(true);
  });

  it("refuses a method outside a companion's allowlist before the map is read", () => {
    const gate = gateOver([], handlersRecording([]));
    expect(gate.resolve(authedState("mobile", 0), "getUiState")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    // Forbidden, not unknown: the class answers first, so the two refusals are
    // not an oracle for what this host implements.
    expect(gate.resolve(authedState("mobile", 0), "nosuch")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(gate.resolve(authedState("web", 0), "nosuch")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});

describe("what a socket may be told", () => {
  it("delivers an event to the class that may receive it", () => {
    const web = socketFor("web");
    gateOver([web]).broadcast("onAppState", { phase: "ready", agent: "idle" });
    expect(web.events()).toEqual(["onAppState"]);
  });

  it("WITHHOLDS an event a companion's allowlist does not name", () => {
    const mobile = socketFor("mobile");
    const gate = gateOver([mobile]);

    gate.broadcast("onAppState", { phase: "ready", agent: "idle" });
    gate.broadcast("onKnowledgeUpdated", {});
    expect(mobile.events()).toEqual([]);

    gate.broadcast("onDelegationsUpdated", { delegations: [] });
    expect(mobile.events()).toEqual(["onDelegationsUpdated"]);
  });

  it("withholds spoken note bytes from a companion, and delivers them to the web client", () => {
    // onTtsAudio is a BINARY channel, so it is the one push that does not take
    // the JSON path — and raw PCM of the user's notes is the payload the
    // companion allowlist most has to exclude.
    expect(REMOTE_ALLOWED_EVENTS).not.toContain("onTtsAudio");
    const mobile = socketFor("mobile");
    const web = socketFor("web");
    gateOver([mobile, web]).broadcast("onTtsAudio", { audio: new ArrayBuffer(4) });

    expect(mobile.binaryFrames()).toHaveLength(0);
    expect(web.binaryFrames()).toHaveLength(1);
  });

  it("pushes nothing on a binary channel handed something that is not bytes", () => {
    const web = socketFor("web");
    gateOver([web]).broadcast("onTtsAudio", { audio: "not bytes" });
    expect(web.binaryFrames()).toHaveLength(0);
  });

  it("skips a socket that never authenticated, and one that is closing", () => {
    const pending = fakeSocket(pendingState(Date.now(), "https://inteligir.com"));
    const stale = fakeSocket(null);
    const closing = socketFor("web", WebSocket.READY_STATE_CLOSED);
    gateOver([pending, stale, closing]).broadcast("onKnowledgeUpdated", {});

    expect(pending.events()).toEqual([]);
    expect(stale.events()).toEqual([]);
    expect(closing.events()).toEqual([]);
  });
});

describe("the reconnect hydration push", () => {
  it("hands a web client every hydrated event", async () => {
    const calls: string[] = [];
    const web = socketFor("web");
    await gateOver([web], handlersRecording(calls)).hydrate(web, authedState("web", 0));

    expect(web.events()).toEqual([
      "onAppState",
      "onDelegationsUpdated",
      "onRoutinesUpdated",
      "onAiProviderChanged",
    ]);
  });

  it("resolves NOTHING a companion could not have asked for", async () => {
    // The sharp end of the gate: hydration runs the getter host-side, so a
    // missing check here volunteers state the method gate forbids asking for.
    // The assertion is on the CALLS, not only on the frames.
    const calls: string[] = [];
    const mobile = socketFor("mobile");
    await gateOver([mobile], handlersRecording(calls)).hydrate(mobile, authedState("mobile", 0));

    expect(calls).toEqual(["listDelegations"]);
    expect(mobile.events()).toEqual(["onDelegationsUpdated"]);
  });

  it("survives a getter that throws", async () => {
    const web = socketFor("web");
    const gate = gateOver([web], {
      getAppState: () => {
        throw new Error("storage went away");
      },
      listDelegations: () => ({ delegations: [] }),
    });
    await gate.hydrate(web, authedState("web", 0));
    // The failing getter is skipped; the rest of the push still lands.
    expect(web.events()).toEqual(["onDelegationsUpdated"]);
  });
});
