// ---------------------------------------------------------------------------
// The host's handler map, its capability policy, and its origin gate — the
// pure halves, driven directly rather than over a socket.
//
// The load-bearing assertion is COMPLETENESS: every host method the registry
// declares has an answer, and the ones with no backend answer by naming the
// gap. A method left unregistered is a Bridge call that hangs forever.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { HostMethod } from "@repo/bridge/ipc-registry";

import { matchHostAssetPath } from "../host/asset-route";
import { mayInvoke, mayReceive } from "../host/client-class";
import { collectHandlers, HOST_METHODS } from "../host/handler-registry";
import { CLOUD_RETIRED, CLOUD_SHIMS, registerCloudHandlers } from "../host/handlers";
import { userHostName } from "../host/host-address";
import { HostEvents } from "../host/host-events";
import { allowedOrigins, originAllowed } from "../host/origins";
import { createCloudStores } from "../host/stores";
import { matchHostSocketPath } from "../host/ws-route";

/** The methods this host answers for real. Pinned as a list so a shim quietly
 * becoming an implementation (or the reverse) is a failing test, not a diff
 * nobody read. */
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
    const handlers = collectHandlers((handle, shim) => {
      registerCloudHandlers(handle, shim, {
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

const pendingMethods: readonly HostMethod[] = CLOUD_SHIMS.flatMap((group) => group.methods);
const retiredMethods: readonly HostMethod[] = CLOUD_RETIRED.flatMap((group) => group.methods);
const shimmedMethods: readonly HostMethod[] = [...pendingMethods, ...retiredMethods];

describe("cloud handler registry", () => {
  it("registers every host method the IPC registry declares", async () => {
    await withHandlers(({ handlers }) => {
      const registered = Object.keys(handlers);
      expect(registered).toHaveLength(HOST_METHODS.length);
      expect(registered.toSorted()).toEqual([...HOST_METHODS].toSorted());
    });
  });

  it("splits those methods into 63 implementations and 8 pending, with nothing retired", () => {
    // The counts are the backlog's progress bar: 71 host methods (88 IPC
    // entries minus 17 events). CLOUD_RETIRED is empty and that is the point —
    // every capability a client can name, this host either answers or owes.
    expect(HOST_METHODS).toHaveLength(71);
    expect(IMPLEMENTED).toHaveLength(63);
    expect(pendingMethods).toHaveLength(8);
    expect(retiredMethods).toHaveLength(0);
    expect(new Set(shimmedMethods).size, "a method is shimmed twice").toBe(shimmedMethods.length);
    expect([...IMPLEMENTED, ...shimmedMethods].toSorted()).toEqual([...HOST_METHODS].toSorted());
  });

  it("answers a backlog shim by naming what it waits on", async () => {
    await withHandlers(async ({ handlers }) => {
      for (const method of pendingMethods) {
        await expect(async () => handlers[method](undefined)).rejects.toThrow(
          /is not available yet/,
        );
      }
    });
  });

  // A retired capability says so rather than promising "yet": the two refusals
  // are different sentences because they ask the user for different things.
  it("answers a retired shim by naming the decision", async () => {
    await withHandlers(async ({ handlers }) => {
      for (const method of retiredMethods) {
        await expect(async () => handlers[method](undefined)).rejects.toThrow(
          /does not exist here — /,
        );
      }
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
    await withHandlers(async ({ handlers, events }) => {
      expect(await handlers.getAppState(undefined)).toEqual({ phase: "ready", agent: "idle" });

      const seen: unknown[] = [];
      events.onAny((method, payload) => {
        if (method === "onAppState") seen.push(payload);
      });
      await handlers.transition({ type: "SETUP" });
      expect(seen).toEqual([{ phase: "ready", agent: "idle" }]);

      await expect(async () => handlers.transition({ type: "RESET_APP_DATA" })).rejects.toThrow(
        /app-data reset is not available/,
      );
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
    // A browser always sends one, so absence means a non-browser caller.
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
  it("matches only a GET on /v1/host/:userId/ws", () => {
    expect(matchHostSocketPath("GET", "/v1/host/user-123/ws")).toBe("user-123");
    expect(matchHostSocketPath("GET", "/v1/host/a%2Fb/ws")).toBe("a/b");
    expect(matchHostSocketPath("POST", "/v1/host/user-123/ws")).toBeNull();
    expect(matchHostSocketPath("GET", "/v1/host//ws")).toBeNull();
    expect(matchHostSocketPath("GET", "/v1/host/user-123")).toBeNull();
    expect(matchHostSocketPath("GET", "/v1/vault/abc/manifest")).toBeNull();
  });

  it("matches only a POST on /v1/host/:userId/assets", () => {
    expect(matchHostAssetPath("POST", "/v1/host/user-123/assets")).toBe("user-123");
    expect(matchHostAssetPath("GET", "/v1/host/user-123/assets")).toBeNull();
    // The two leaves never answer for each other.
    expect(matchHostAssetPath("POST", "/v1/host/user-123/ws")).toBeNull();
    expect(matchHostSocketPath("GET", "/v1/host/user-123/assets")).toBeNull();
  });
});
