// ---------------------------------------------------------------------------
// The host's handler map, its capability policy, its origin allowlist and its
// route shape — the pure halves, driven directly rather than over a socket.
//
// The load-bearing assertion is COMPLETENESS: every host method the registry
// declares is implemented here. A method left unregistered is a Bridge call
// that hangs forever.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { EventMethod } from "@repo/bridge/ipc-contract";

import { mayInvoke, mayReceive } from "../host/client-class";
import { HOST_METHODS, type HostHandlers } from "../host/handler-registry";
import { userHostName } from "../host/host-address";
import { composeHost } from "../host/host-composition";
import { allowedOrigins, originAllowed } from "../host/origins";
import { matchHostLeaf } from "../host/host-route";

/**
 * The handler map, built by the SAME `composeHost` the Durable Object's own
 * constructor calls — so what these suites assert about is what production
 * wires. A hand-copied services record was a second composition that drifted
 * from the one the socket reaches, which is exactly the drift a completeness
 * assertion must not have under it.
 *
 * Built INSIDE the object so the vault's real SQLite + R2 substrate is behind
 * it: a `SqlStorage` handle is bound to the object's I/O context and cannot be
 * used once it has been handed back out.
 */
function withHandlers<T>(
  run: (ctx: { handlers: HostHandlers; emitted: Emitted[] }) => Promise<T> | T,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName("handler-fixture"));
  return runInDurableObject(stub, (_host, ctx) => {
    const emitted: Emitted[] = [];
    const composition = composeHost({
      env,
      ctx,
      emit: (method, payload) => {
        emitted.push({ method, payload });
      },
      onDeadlineChanged: () => {},
    });
    return run({ handlers: composition.handlers, emitted });
  });
}

/** One announcement the composition made. Production hands `emit` to the gate,
 * which decides which sockets hear it; here it is just recorded. */
type Emitted = { method: EventMethod; payload: unknown };

describe("cloud handler registry", () => {
  // Against the registry, never against a written-down copy of it: a pinned
  // list asserts what `collectHandlers` already refuses to construct without,
  // and its only real effect is a hand-maintained count someone forgets to bump.
  it("registers every host method the IPC registry declares, and nothing else", async () => {
    await withHandlers(({ handlers }) => {
      expect(Object.keys(handlers).toSorted()).toEqual([...HOST_METHODS].toSorted());
    });
  });

  it("persists ui state and notification settings through the store", async () => {
    await withHandlers(async ({ handlers }) => {
      await handlers.setUiState({ key: "workspace.openNote", value: "notes/ideas.md" });
      expect(await handlers.getUiState(undefined)).toEqual({
        "workspace.openNote": "notes/ideas.md",
      });

      await handlers.setUiState({ key: "workspace.openNote", value: undefined });
      expect(await handlers.getUiState(undefined)).toEqual({});

      expect(await handlers.getNotificationSettings(undefined)).toEqual({ enabled: true });
      expect(await handlers.updateNotificationSettings({ enabled: false })).toEqual({
        enabled: false,
      });
      // An absent `enabled` must not overwrite the live setting.
      expect(await handlers.updateNotificationSettings({})).toEqual({ enabled: false });
    });
  });

  it("reports a ready app phase and re-announces it on SETUP", async () => {
    await withHandlers(async ({ handlers, emitted }) => {
      expect(await handlers.getAppState(undefined)).toEqual({ phase: "ready", agent: "idle" });

      const before = emitted.length;
      await handlers.transition({ type: "SETUP" });
      expect(emitted.slice(before)).toEqual([
        { method: "onAppState", payload: { phase: "ready", agent: "idle" } },
      ]);
    });
  });
});

describe("capability classes", () => {
  it("grants the web workspace the whole host surface", () => {
    for (const method of HOST_METHODS) expect(mayInvoke("web", method)).toBe(true);
    expect(mayReceive("web", "onAppState")).toBe(true);
    expect(mayReceive("web", "onKnowledgeUpdated")).toBe(true);
  });

  it("holds a companion client to the companion surface", () => {
    expect(mayInvoke("mobile", "listDelegations")).toBe(true);
    expect(mayInvoke("mobile", "sendAgentCommand")).toBe(true);
    expect(mayInvoke("mobile", "getUiState")).toBe(false);
    expect(mayInvoke("mobile", "transition")).toBe(false);

    expect(mayReceive("mobile", "onAgentEvent")).toBe(true);
    expect(mayReceive("mobile", "onAppState")).toBe(false);
  });

  it("fails closed on a method no allowlist names", () => {
    expect(mayInvoke("mobile", "someMethodAddedTomorrow")).toBe(false);
    expect(mayReceive("mobile", "onSomethingAddedTomorrow")).toBe(false);
  });
});

describe("origin allowlist", () => {
  // The env is stated, never inherited: `allowedOrigins` takes the one var it
  // reads (OriginEnv), so "nothing is configured" below means an unconfigured
  // DEPLOYMENT rather than whatever the developer happens to have in .dev.vars.
  const DEV_ORIGIN = "http://localhost:5174";

  it("admits the deployed origins and whatever config names", () => {
    const configured = allowedOrigins({ HOST_ALLOWED_ORIGINS: DEV_ORIGIN });
    expect(originAllowed("https://inteligir.com", configured)).toBe(true);
    expect(originAllowed("http://localhost:5174", configured)).toBe(true);
  });

  it("rejects an absent origin", () => {
    // The allowlist only ever corroborates a cookie, and a browser always
    // sends an origin with one — so absence is not a browser.
    expect(originAllowed(null, allowedOrigins({}))).toBe(false);
  });

  it("matches the WHOLE origin, not the hostname", () => {
    const configured = allowedOrigins({ HOST_ALLOWED_ORIGINS: DEV_ORIGIN });
    expect(originAllowed("http://localhost:5173", configured)).toBe(false);
    expect(originAllowed("https://localhost:5174", configured)).toBe(false);
    expect(originAllowed("https://inteligir.com.evil.example", configured)).toBe(false);
    expect(originAllowed("file://", configured)).toBe(false);
  });

  it("admits nothing extra when nothing is configured", () => {
    const bare = allowedOrigins({});
    expect(originAllowed(DEV_ORIGIN, bare)).toBe(false);
    expect([...bare]).toEqual(["https://inteligir.com", "https://www.inteligir.com"]);
  });
});

describe("host routes", () => {
  it("matches one leaf, on one method, with no id segment to supply", () => {
    expect(matchHostLeaf("POST", "/v1/host/ticket")).toBe("ticket");
    expect(matchHostLeaf("GET", "/v1/host/ws")).toBe("ws");
    expect(matchHostLeaf("POST", "/v1/host/assets")).toBe("assets");
    expect(matchHostLeaf("POST", "/v1/host/link")).toBe("link");
    expect(matchHostLeaf("GET", "/v1/host/export")).toBe("export");
  });

  it("refuses the wrong method, an unknown leaf, and anything addressed", () => {
    expect(matchHostLeaf("POST", "/v1/host/ws")).toBeNull();
    expect(matchHostLeaf("GET", "/v1/host/assets")).toBeNull();
    expect(matchHostLeaf("POST", "/v1/host/nosuch")).toBeNull();
    // The shape that let a caller name an object is gone, so it matches
    // nothing rather than addressing something.
    expect(matchHostLeaf("GET", "/v1/host/user-123/ws")).toBeNull();
    expect(matchHostLeaf("POST", "/v1/host/user-123/assets")).toBeNull();
    expect(matchHostLeaf("GET", "/v1/host/")).toBeNull();
  });
});
