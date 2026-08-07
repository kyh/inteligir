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

import type { HostMethod } from "@repo/bridge/ipc-registry";

import { mayInvoke, mayReceive } from "../host/client-class";
import { collectHandlers, HOST_METHODS } from "../host/handler-registry";
import { registerCloudHandlers } from "../host/handlers";
import { userHostName } from "../host/host-address";
import { HostEvents } from "../host/host-events";
import { allowedOrigins, originAllowed } from "../host/origins";
import { createCloudStores } from "../host/stores";
import { matchHostLeaf } from "../host/host-route";

/** The methods this host answers. Pinned as a list rather than derived, so a
 * channel arriving or leaving is a diff someone had to write down. */
const IMPLEMENTED: readonly HostMethod[] = [
  "getAppState",
  "transition",
  "getUiState",
  "setUiState",
  "getNotificationSettings",
  "updateNotificationSettings",
  "getVaultRoot",
  "listVault",
  "readVaultDoc",
  "getVaultFileFacts",
  "writeVaultDoc",
  "deleteVaultEntry",
  "renameVaultEntry",
  "writeVaultAsset",
  "readVaultAsset",
  "refreshVault",
  "getBacklinks",
  "getForwardLinks",
  "getLinkGraph",
  "searchVault",
  "listWikiTargets",
  "listVaultTasks",
  "toggleVaultTask",
  "sendAgentCommand",
  "getAgentHistory",
  "listChatSessions",
  "readChatSession",
  "reauthenticate",
  "setFauxAgentScript",
  "getAgentSystemPrompt",
  "resolveAgentConfirmation",
  "getAiProviderSettings",
  "setAiProviderConfig",
  "connectAiProvider",
  "disconnectAiProvider",
  "createDelegation",
  "listDelegations",
  "cancelDelegation",
  "restoreDelegationSnapshot",
  "listRoutines",
  "upsertRoutine",
  "deleteRoutine",
  "runRoutineNow",
  "restoreRoutineRun",
  "restoreAgentEdits",
  "generateInlineAi",
  "cancelInlineAi",
  "classifyAiIntent",
  "generateGhostText",
  "cancelGhostText",
  "listGhostModels",
  "isTtsAvailable",
  "setVoiceApiKey",
  "ttsSend",
  "ttsFlush",
  "ttsInterrupt",
  "startStt",
  "sendSttAudio",
  "stopStt",
  "ackCapture",
  "takePendingDeepLinkNav",
  "listSkills",
  "createSkill",
];

/** An in-memory stand-in for `ctx.storage.kv` — the same synchronous contract. */
function memoryKv() {
  const entries = new Map<string, string>();
  return {
    get: (key: string) => entries.get(key),
    put: (key: string, value: string) => {
      entries.set(key, value);
    },
    delete: (key: string) => {
      entries.delete(key);
    },
  };
}

/**
 * A fresh handler map, built INSIDE a Durable Object so the vault's real
 * SQLite + R2 substrate is behind it. The callback runs there too — a
 * `SqlStorage` handle is bound to the object's I/O context and cannot be used
 * once it has been handed back out.
 */
function withHandlers<T>(
  run: (ctx: {
    handlers: ReturnType<typeof collectHandlers>;
    events: HostEvents;
  }) => Promise<T> | T,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName("handler-fixture"));
  return runInDurableObject(stub, (host) => {
    const events = new HostEvents();
    const stores = createCloudStores(memoryKv());
    const handlers = collectHandlers((handle) => {
      registerCloudHandlers(handle, {
        stores,
        events,
        vault: host.vault,
        knowledge: host.knowledge,
        // The object's OWN agent composition: these suites assert the handler
        // map's shape, and a second composition would be answering for a
        // different runner than the one the socket reaches.
        agent: {
          env,
          userId: "handler-fixture",
          runner: host.agent.runner,
          chat: host.agent.chat,
          credentials: host.agent.credentials,
          origin: () => "https://inteligir.com",
          scripted: host.agent.scripted,
          announce: () => {},
        },
        background: {
          delegations: host.agent.delegations,
          routines: host.agent.routines,
          snapshots: host.agent.snapshots,
        },
        ai: host.ai,
        voice: host.voice,
        capture: { inbox: host.captureInbox, service: host.capture },
      });
    });
    return run({ handlers, events });
  });
}

describe("cloud handler registry", () => {
  it("registers every host method the IPC registry declares", async () => {
    await withHandlers(({ handlers }) => {
      const registered = Object.keys(handlers);
      expect(registered).toHaveLength(HOST_METHODS.length);
      expect(registered.toSorted()).toEqual([...HOST_METHODS].toSorted());
    });
  });

  it("implements every one of them — there is no second pile", () => {
    expect(HOST_METHODS).toHaveLength(63);
    expect(IMPLEMENTED).toHaveLength(63);
    expect(new Set(IMPLEMENTED).size, "a method is listed twice").toBe(IMPLEMENTED.length);
    expect([...IMPLEMENTED].toSorted()).toEqual([...HOST_METHODS].toSorted());
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
    await withHandlers(async ({ handlers, events }) => {
      expect(await handlers.getAppState(undefined)).toEqual({ phase: "ready", agent: "idle" });

      const seen: unknown[] = [];
      events.onAny((method, payload) => {
        if (method === "onAppState") seen.push(payload);
      });
      await handlers.transition({ type: "SETUP" });
      expect(seen).toEqual([{ phase: "ready", agent: "idle" }]);
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
