// ---------------------------------------------------------------------------
// The UserHost Durable Object, driven over a real miniflare socket: the ticket
// mint and the class it decides, the first-frame exchange that spends one, the
// hibernation-safe auth deadline, the capability gate on both client classes,
// the hydration push, and — the load-bearing one — that an EVICTED host
// rebuilds its socket set from attachments rather than from memory it no longer
// has.
// ---------------------------------------------------------------------------

import { UI_STATE_OPEN_NOTE_KEY } from "@repo/bridge/ui-state";
import { WS_CLOSE_UNAUTHORIZED } from "@repo/bridge/ws-protocol";
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { userHostName } from "../host/host-address";
import { SEED_OPEN_NOTE } from "../host/vault/seed";
import {
  accepted,
  authenticated,
  invoke,
  mintTicket,
  ORIGIN,
  signUp,
  ticketFor,
  WEB_ORIGIN,
  type Account,
} from "./host-helpers";

const READY_STATE = { phase: "ready", agent: "idle" };

// One account per Durable Object under test: a host is per-user, so sharing
// one would let a test's leftover sockets and stored state reach the next.
let owner: Account;
let pendingOwner: Account;
let unknownProbe: Account;
let companion: Account;
let evicted: Account;
let persisted: Account;

beforeAll(async () => {
  owner = await signUp("host-owner@example.com");
  pendingOwner = await signUp("host-pending@example.com");
  unknownProbe = await signUp("host-unknown@example.com");
  companion = await signUp("host-companion@example.com");
  evicted = await signUp("host-evicted@example.com");
  persisted = await signUp("host-persisted@example.com");
});

describe("the ticket mint", () => {
  it("admits a cookie from an allowlisted origin as the web class", async () => {
    const response = await mintTicket(owner, "web");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ticket: string; expiresAt: number };
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("admits a bearer with no browser origin as the companion class", async () => {
    // The class is decided from WHICH CREDENTIAL arrived, and nothing else —
    // the proof is the capability gate this socket lands behind, below.
    const response = await mintTicket(companion, "mobile");
    expect(response.status).toBe(200);
  });

  it("refuses a cookie from an origin the allowlist does not name", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/host/ticket`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("refuses a cookie with no origin, and a bearer that carries one", async () => {
    // Both are a credential disagreeing with the way it arrived: a cookie no
    // browser attached, and a non-browser reaching for the browser class.
    const cookieNoOrigin = await SELF.fetch(`${ORIGIN}/v1/host/ticket`, {
      method: "POST",
      headers: { cookie: owner.cookie },
    });
    expect(cookieNoOrigin.status).toBe(403);

    const bearerWithOrigin = await SELF.fetch(`${ORIGIN}/v1/host/ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.token}`, origin: WEB_ORIGIN },
    });
    expect(bearerWithOrigin.status).toBe(403);
  });

  it("refuses a caller with no credential at all — and wakes no object", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/host/ticket`, {
      method: "POST",
      headers: { origin: WEB_ORIGIN },
    });
    expect(response.status).toBe(401);
  });
});

describe("first-frame auth", () => {
  it("welcomes a fresh ticket and hydrates through both gates", async () => {
    const ticket = await ticketFor(owner);
    const { ws, frames } = await accepted(owner);
    ws.send(JSON.stringify({ t: "auth", ticket }));
    expect(await frames.next()).toEqual({ t: "welcome" });

    // One push per HYDRATED_EVENTS getter — the app phase, the delegation dock,
    // the routines list and the AI provider snapshot. The index broadcast that
    // follows is the seed being projected, which happens after the welcome by
    // design.
    ws.send(JSON.stringify({ t: "req", id: 1, method: "getAppState" }));
    const events: string[] = [];
    for (;;) {
      const frame = await frames.next();
      if (frame.t === "evt") {
        events.push(frame.method);
        continue;
      }
      expect(frame).toEqual({ t: "res", id: 1, ok: true, result: READY_STATE });
      break;
    }
    expect(events.filter((event) => event !== "onKnowledgeUpdated")).toEqual([
      "onAppState",
      "onDelegationsUpdated",
      "onRoutinesUpdated",
      "onAiProviderChanged",
    ]);
    ws.close(1000, "done");
  });

  it("spends a ticket exactly once", async () => {
    const ticket = await ticketFor(owner);
    const first = await accepted(owner);
    first.ws.send(JSON.stringify({ t: "auth", ticket }));
    expect(await first.frames.next()).toEqual({ t: "welcome" });

    const second = await accepted(owner);
    second.ws.send(JSON.stringify({ t: "auth", ticket }));
    expect(await second.frames.closed).toBe(WS_CLOSE_UNAUTHORIZED);
    first.ws.close(1000, "done");
  });

  it("fans a provider change to every socket, not just the caller", async () => {
    // The selection is per ACCOUNT, so a second tab that only ever read the
    // snapshot would keep rendering a provider the next turn will not run on.
    const a = await authenticated(owner);
    const b = await authenticated(owner);

    const changed = b.frames.next();
    const res = await invoke(a.ws, a.frames, 10, "setAiProviderConfig", {
      provider: "sandbox",
    });
    expect(res.ok).toBe(true);

    const frame = await changed;
    expect(frame.t).toBe("evt");
    if (frame.t !== "evt") throw new Error("expected an event frame");
    expect(frame.method).toBe("onAiProviderChanged");

    // Disconnect is the other mutating half and would drift on its own.
    const disconnected = b.frames.next();
    await invoke(a.ws, a.frames, 11, "disconnectAiProvider", { provider: "sandbox" });
    const second = await disconnected;
    expect(second.t === "evt" && second.method).toBe("onAiProviderChanged");

    a.ws.close(1000, "done");
    b.ws.close(1000, "done");
  });

  it("refuses a ticket another user's host minted", async () => {
    // A ticket lives in the object that minted it, so one minted elsewhere is
    // simply not here — there is no userId to compare and none to forge.
    const foreign = await ticketFor(unknownProbe);
    const { ws, frames } = await accepted(owner);
    ws.send(JSON.stringify({ t: "auth", ticket: foreign }));
    expect(await frames.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("refuses the session token the ticket replaced", async () => {
    const { ws, frames } = await accepted(owner);
    ws.send(JSON.stringify({ t: "auth", ticket: owner.token }));
    expect(await frames.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("refuses an upgrade with no credential to address an object with", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/host/ws`, {
      headers: { upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeNull();
  });

  it("refuses any frame that is not an auth frame", async () => {
    const { ws, frames } = await accepted(owner);
    ws.send(JSON.stringify({ t: "req", id: 1, method: "getAppState" }));
    expect(await frames.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });
});

describe("auth deadline", () => {
  it("reaps an unauthenticated socket from an alarm, not a timer", async () => {
    // A setTimeout would pin the object in memory, which is the hibernation
    // this transport exists to get; an alarm survives eviction, so a socket
    // that says nothing at all is still reaped.
    const { frames } = await accepted(pendingOwner);
    const stub = env.UserHost.getByName(userHostName(pendingOwner.userId));

    const armed = await runInDurableObject(stub, (_host, state) => state.storage.getAlarm());
    expect(armed).not.toBeNull();
    expect(armed ?? 0).toBeGreaterThan(Date.now());

    // Rewind the socket past its deadline rather than waiting out ten seconds.
    await runInDurableObject(stub, (_host, state) => {
      for (const socket of state.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as { phase: string };
        if (attachment.phase !== "pending") continue;
        socket.serializeAttachment({ ...attachment, since: Date.now() - 60_000 });
      }
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await frames.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });
});

describe("capability classes", () => {
  it("holds a companion client to its allowlist", async () => {
    // A REAL admission: bearer, no browser origin, so the mint decided
    // `mobile` and the socket landed behind that class's allowlist.
    const { ws, frames } = await authenticated(companion, "mobile");

    ws.send(JSON.stringify({ t: "req", id: 1, method: "getUiState" }));
    expect(await frames.next()).toEqual({
      t: "res",
      id: 1,
      ok: false,
      error: "getUiState is not available to this client",
    });

    // A method that does not exist is ALSO `forbidden` here, not `unknown`:
    // the class gate answers before the map is consulted, so a client outside
    // a capability cannot use the two refusals as an oracle for which methods
    // a host implements.
    ws.send(JSON.stringify({ t: "req", id: 2, method: "nosuch" }));
    expect(await frames.next()).toEqual({
      t: "res",
      id: 2,
      ok: false,
      error: "nosuch is not available to this client",
    });

    // An allowlisted method reaches its handler and is ANSWERED, which is what
    // proves the gate let it past rather than answering for it.
    ws.send(JSON.stringify({ t: "req", id: 3, method: "listDelegations" }));
    expect(await frames.next()).toEqual({
      t: "res",
      id: 3,
      ok: true,
      result: { delegations: [] },
    });

    ws.close(1000, "done");
  });

  it("answers `unknown` to a web client, which is forbidden nothing", async () => {
    const { ws, frames } = await authenticated(unknownProbe);
    ws.send(JSON.stringify({ t: "req", id: 1, method: "nosuch" }));
    expect(await frames.next()).toEqual({
      t: "res",
      id: 1,
      ok: false,
      error: "nosuch is not available on this host",
    });
    ws.close(1000, "done");
  });
});

describe("hibernation", () => {
  it("rebuilds its socket set from attachments after eviction", async () => {
    const { ws, frames } = await authenticated(evicted);
    const stub = env.UserHost.getByName(userHostName(evicted.userId));

    // Tears down the instance — every in-memory field with it — while the
    // sockets stay open, which is exactly what a real hibernation does.
    await evictDurableObject(stub);

    // The session survived: it was read back out of the socket's attachment.
    // The one key present is the seed's landing note (./vault/seed) — this
    // account authenticated here for the first time, which is what seeds it.
    ws.send(JSON.stringify({ t: "req", id: 5, method: "getUiState" }));
    expect(await frames.next()).toEqual({
      t: "res",
      id: 5,
      ok: true,
      result: { [UI_STATE_OPEN_NOTE_KEY]: SEED_OPEN_NOTE },
    });

    // And the BROADCAST set survived, which a held Map could not have: the
    // transition handler emits onAppState, and it still reaches this socket.
    ws.send(JSON.stringify({ t: "req", id: 6, method: "transition", payload: { type: "SETUP" } }));
    expect(await frames.next()).toEqual({
      t: "evt",
      method: "onAppState",
      payload: READY_STATE,
    });
    expect(await frames.next()).toEqual({ t: "res", id: 6, ok: true, result: undefined });
    ws.close(1000, "done");
  });

  it("keeps ui state across an eviction", async () => {
    const { ws, frames } = await authenticated(persisted);
    const stub = env.UserHost.getByName(userHostName(persisted.userId));

    ws.send(
      JSON.stringify({
        t: "req",
        id: 10,
        method: "setUiState",
        payload: { key: "workspace.openNote", value: "notes/ideas.md" },
      }),
    );
    expect(await frames.next()).toMatchObject({ id: 10, ok: true });

    await evictDurableObject(stub);

    ws.send(JSON.stringify({ t: "req", id: 11, method: "getUiState" }));
    expect(await frames.next()).toEqual({
      t: "res",
      id: 11,
      ok: true,
      result: { "workspace.openNote": "notes/ideas.md" },
    });
    ws.close(1000, "done");
  });
});
