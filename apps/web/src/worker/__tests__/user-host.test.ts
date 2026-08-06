// ---------------------------------------------------------------------------
// The UserHost Durable Object, driven over a real miniflare socket: the origin
// gate, the first-frame auth exchange and its name binding, the hibernation-safe
// auth deadline, the capability gate on both client classes, the hydration
// push, and — the load-bearing one — that an EVICTED host rebuilds its socket
// set from attachments rather than from memory it no longer has.
// ---------------------------------------------------------------------------

import { WS_CLOSE_UNAUTHORIZED } from "@repo/bridge/ws-protocol";
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { userHostName } from "../host/host-address";
import {
  accepted,
  authenticated,
  openSocket,
  readFrames,
  signUp,
  WEB_ORIGIN,
  type Account,
} from "./host-helpers";

const READY_STATE = { phase: "ready", agent: "idle" };

// One account per Durable Object under test: a host is per-user, so sharing
// one would let a test's leftover sockets and stored state reach the next.
let owner: Account;
let pendingOwner: Account;
let unknownProbe: Account;
let evicted: Account;
let persisted: Account;

beforeAll(async () => {
  owner = await signUp("host-owner@example.com");
  pendingOwner = await signUp("host-pending@example.com");
  unknownProbe = await signUp("host-unknown@example.com");
  evicted = await signUp("host-evicted@example.com");
  persisted = await signUp("host-persisted@example.com");
});

describe("origin gate", () => {
  it("admits an allowlisted origin", async () => {
    const response = await openSocket(owner.userId, WEB_ORIGIN);
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");
  });

  it("refuses an origin the allowlist does not name, as an HTTP 403", async () => {
    const response = await openSocket(owner.userId, "https://evil.example");
    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it("refuses an ABSENT origin — a browser always sends one", async () => {
    // Answered before the Upgrade on purpose: a close code after a completed
    // handshake would tell the caller their upgrade succeeded.
    const response = await openSocket(owner.userId, null);
    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });
});

describe("first-frame auth", () => {
  it("welcomes a valid session and hydrates through both gates", async () => {
    const { ws, frames } = await accepted(owner.userId);
    ws.send(JSON.stringify({ t: "auth", token: owner.token }));
    expect(await frames.next()).toEqual({ t: "welcome" });

    // One push per HYDRATED_EVENTS getter this host answers — the app phase,
    // the delegation dock and the routines list. The sync and remote-access
    // getters are shims that throw, so their events are never pushed, which is
    // the design working. The index broadcast that follows is the seed being
    // projected, which happens after the welcome by design.
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
    ]);
    ws.close(1000, "done");
  });

  it("refuses a session that names another user's host", async () => {
    // The userId in the URL is an address, not a credential: the object binds
    // the session to its own name and refuses anything else.
    const { ws, frames } = await accepted("stranger");
    ws.send(JSON.stringify({ t: "auth", token: owner.token }));
    expect(await frames.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("refuses any frame that is not an auth frame", async () => {
    const { ws, frames } = await accepted(owner.userId);
    ws.send(JSON.stringify({ t: "req", id: 1, method: "getAppState" }));
    expect(await frames.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });
});

describe("auth deadline", () => {
  it("reaps an unauthenticated socket from an alarm, not a timer", async () => {
    // A setTimeout would pin the object in memory, which is the hibernation
    // this transport exists to get; an alarm survives eviction, so a socket
    // that says nothing at all is still reaped.
    const { frames } = await accepted(pendingOwner.userId);
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
  it("holds a mobile client to its allowlist", async () => {
    // A mobile credential has no admission path yet, so the attachment a
    // mobile admission WOULD write is set here directly. In production the
    // only producer is authenticate(); this drives the gate the same way it
    // will be driven then.
    const stub = env.UserHost.getByName(userHostName("mobile-fixture"));
    await runInDurableObject(stub, async (host, state) => {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      state.acceptWebSocket(server);
      client.accept();
      server.serializeAttachment({
        v: 1,
        phase: "authed",
        userId: "mobile-fixture",
        sessionId: "test-session",
        clientClass: "mobile",
        authedAt: Date.now(),
      });
      const frames = readFrames(client);

      await host.webSocketMessage(
        server,
        JSON.stringify({ t: "req", id: 1, method: "getUiState" }),
      );
      expect(await frames.next()).toEqual({
        t: "res",
        id: 1,
        ok: false,
        error: "getUiState is not available to this client",
      });

      // A method that does not exist is ALSO `forbidden` here, not `unknown`:
      // the class gate answers before the map is consulted, so a client
      // outside a capability cannot use the two refusals as an oracle for
      // which methods a host implements.
      await host.webSocketMessage(server, JSON.stringify({ t: "req", id: 2, method: "nosuch" }));
      expect(await frames.next()).toEqual({
        t: "res",
        id: 2,
        ok: false,
        error: "nosuch is not available to this client",
      });

      // An allowlisted method reaches its handler and is ANSWERED, which is
      // what proves the gate let it past rather than answering for it.
      await host.webSocketMessage(
        server,
        JSON.stringify({ t: "req", id: 3, method: "listDelegations" }),
      );
      expect(await frames.next()).toEqual({
        t: "res",
        id: 3,
        ok: true,
        result: { delegations: [] },
      });

      server.close(1000, "done");
    });
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
    ws.send(JSON.stringify({ t: "req", id: 5, method: "getUiState" }));
    expect(await frames.next()).toEqual({ t: "res", id: 5, ok: true, result: {} });

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
