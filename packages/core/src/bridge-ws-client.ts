// ---------------------------------------------------------------------------
// Browser WebSocket Bridge — folds the IPC registry into the bridge-wire
// protocol so the portable app runs against @repo/server in a plain browser.
// Browser APIs only (WebSocket, timers); the node counterpart lives in
// @repo/server/create-server.
//
// Connection policy: on socket close every in-flight request rejects with
// "connection lost" and the bridge reconnects forever with capped exponential
// backoff. Requests made while a socket is still CONNECTING are queued and
// flushed on open (covers the app's boot burst); requests made while fully
// disconnected reject immediately. After a *re*connect the bridge re-emits
// the two refresh events the app already handles — `onVaultChanged` (sidebar
// re-list + open-file reload) and `onAppState` (auth/agent phase) — so the UI
// converges on the host's current state without a bespoke resync channel.
// ---------------------------------------------------------------------------

import {
  BINARY_TAG_STT_PCM,
  BINARY_TAG_TTS_PCM,
  decodeBinaryFrame,
  encodeBinaryFrame,
  parseServerFrame,
  type WireRequestMethod,
  type WireSendMethod,
} from "./bridge-wire";
import type { Bridge, EventMethod, UpdateState } from "./ipc-registry";

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

/** `connecting` = first socket attempt, `reconnecting` = lost after being
 * open (or a failed retry) — the state a UI overlay should surface. */
export type WsBridgeConnectionState = "connecting" | "open" | "reconnecting";

export type WsBridgeOptions = {
  onConnectionState?: (state: WsBridgeConnectionState) => void;
};

// A WS host has no self-update; the trio never crosses the wire.
const IDLE_UPDATE: UpdateState = {
  status: "not-available",
  version: null,
  downloadPercent: null,
  message: null,
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export function createWsBridge(url: string, options: WsBridgeOptions = {}): Bridge {
  let socket: WebSocket | null = null;
  let everOpened = false;
  let backoffMs = RECONNECT_MIN_MS;
  let nextId = 1;

  const pending = new Map<number, Pending>();
  /** JSON frames written while the socket is still CONNECTING. */
  const outbox: string[] = [];
  const listeners = new Map<EventMethod, Set<(payload: unknown) => void>>();

  function setState(state: WsBridgeConnectionState): void {
    options.onConnectionState?.(state);
  }

  function dispatch(method: EventMethod, payload: unknown): void {
    const set = listeners.get(method);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[bridge-ws] ${method} listener failed:`, err);
      }
    }
  }

  function addListener(method: EventMethod, listener: (payload: unknown) => void): () => void {
    let set = listeners.get(method);
    if (!set) {
      set = new Set();
      listeners.set(method, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  function failAllPending(reason: string): void {
    const rejects = [...pending.values()];
    pending.clear();
    outbox.length = 0;
    for (const entry of rejects) entry.reject(new Error(reason));
  }

  /** Post-reconnect resync: fetch the authoritative state and re-emit it
   * through the same event channels a live host would use. */
  function refreshAfterReconnect(): void {
    void request("getVaultRoot", undefined)
      .then((root) => {
        if (typeof root === "string") dispatch("onVaultChanged", { root });
        return undefined;
      })
      .catch(() => {});
    void request("getAppState", undefined)
      .then((state) => dispatch("onAppState", state))
      .catch(() => {});
  }

  function handleMessage(data: unknown): void {
    if (typeof data === "string") {
      const parsed = parseServerFrame(data);
      if (!parsed.ok) {
        console.error(`[bridge-ws] dropped frame: ${parsed.error}`);
        return;
      }
      const frame = parsed.frame;
      if (frame.t === "evt") {
        dispatch(frame.method, frame.payload);
        return;
      }
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      if (frame.ok) entry.resolve(frame.result);
      else entry.reject(new Error(frame.error));
      return;
    }
    if (data instanceof ArrayBuffer) {
      const frame = decodeBinaryFrame(data);
      if (frame?.tag === BINARY_TAG_TTS_PCM) {
        dispatch("onTtsAudio", { audio: frame.payload.buffer });
      }
    }
  }

  function connect(): void {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    socket = ws;

    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      backoffMs = RECONNECT_MIN_MS;
      const wasReconnect = everOpened;
      everOpened = true;
      setState("open");
      for (const frame of outbox.splice(0)) ws.send(frame);
      if (wasReconnect) refreshAfterReconnect();
    });

    ws.addEventListener("message", (event) => {
      if (socket === ws) handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (socket !== ws) return;
      socket = null;
      failAllPending("connection lost");
      setState(everOpened ? "reconnecting" : "connecting");
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
      setTimeout(() => {
        if (socket === null) connect();
      }, delay);
    });
  }

  /** Send a JSON frame now (open), queue it (connecting), or fail (down). */
  function writeFrame(frame: string): boolean {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(frame);
      return true;
    }
    if (socket?.readyState === WebSocket.CONNECTING) {
      outbox.push(frame);
      return true;
    }
    return false;
  }

  function request(method: WireRequestMethod, payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const frame = JSON.stringify({
        t: "req",
        id,
        method,
        ...(payload === undefined ? {} : { payload }),
      });
      pending.set(id, { resolve, reject });
      if (!writeFrame(frame)) {
        pending.delete(id);
        reject(new Error("connection lost"));
      }
    });
  }

  function fireAndForget(method: WireSendMethod, payload: unknown): void {
    writeFrame(JSON.stringify({ t: "snd", method, ...(payload === undefined ? {} : { payload }) }));
  }

  // The wire carries untyped JSON; each registry method's payload/result types
  // are proven by the registry entry the helper is keyed with, so the single
  // widening below is sound (same pattern as the desktop preload fold, in the
  // other direction). Everything else in this file is cast-free.
  function rpc<K extends WireRequestMethod>(method: K): Bridge[K] {
    const fn = (payload?: unknown) => request(method, payload);
    // oxlint-disable-next-line typescript/consistent-type-assertions -- registry-correlated fold, see comment above
    return fn as Bridge[K];
  }

  function snd<K extends WireSendMethod>(method: K): Bridge[K] {
    const fn = (payload?: unknown) => fireAndForget(method, payload);
    // oxlint-disable-next-line typescript/consistent-type-assertions -- registry-correlated fold, see comment above
    return fn as Bridge[K];
  }

  function sub<K extends EventMethod>(method: K): Bridge[K] {
    const fn = (listener: (payload: unknown) => void) => addListener(method, listener);
    // oxlint-disable-next-line typescript/consistent-type-assertions -- registry-correlated fold, see comment above
    return fn as Bridge[K];
  }

  /** STT PCM rides a tagged binary frame, never JSON. Dropped (not queued)
   * when the socket isn't open — stale realtime audio is worthless. */
  function sendSttAudio(payload: unknown): void {
    if (socket?.readyState !== WebSocket.OPEN) return;
    let bytes: Uint8Array;
    if (payload instanceof ArrayBuffer) {
      bytes = new Uint8Array(payload);
    } else if (ArrayBuffer.isView(payload) && payload.buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    } else {
      return;
    }
    socket.send(encodeBinaryFrame(BINARY_TAG_STT_PCM, bytes));
  }

  setState("connecting");
  connect();

  return {
    // Desktop / updates — no self-update over a WS host; answered locally.
    checkForUpdates: async () => IDLE_UPDATE,
    downloadUpdate: async () => ({ accepted: false, state: IDLE_UPDATE }),
    installUpdate: async () => ({ accepted: false, state: IDLE_UPDATE }),
    onUpdateState: sub("onUpdateState"),

    // App lifecycle
    getAppState: rpc("getAppState"),
    transition: rpc("transition"),
    onAppState: sub("onAppState"),
    onSetupProgress: sub("onSetupProgress"),

    // Agent
    onAgentEvent: sub("onAgentEvent"),
    sendAgentCommand: rpc("sendAgentCommand"),
    getAgentHistory: rpc("getAgentHistory"),
    reauthenticate: rpc("reauthenticate"),

    // Voice — PCM in both directions rides tagged binary frames.
    isTtsAvailable: rpc("isTtsAvailable"),
    ttsSend: snd("ttsSend"),
    ttsFlush: snd("ttsFlush"),
    ttsInterrupt: snd("ttsInterrupt"),
    onTtsAudio: sub("onTtsAudio"),
    startStt: rpc("startStt"),
    sendSttAudio,
    stopStt: rpc("stopStt"),
    onSttTranscript: sub("onSttTranscript"),
    getVoiceModelStatus: rpc("getVoiceModelStatus"),
    downloadVoiceModel: rpc("downloadVoiceModel"),
    onVoiceModelState: sub("onVoiceModelState"),

    // Notifications
    getNotificationSettings: rpc("getNotificationSettings"),
    updateNotificationSettings: rpc("updateNotificationSettings"),

    // UI state
    getUiState: rpc("getUiState"),
    setUiState: rpc("setUiState"),

    // Vault
    getVaultRoot: rpc("getVaultRoot"),
    chooseVaultRoot: rpc("chooseVaultRoot"),
    listVault: rpc("listVault"),
    readVaultDoc: rpc("readVaultDoc"),
    writeVaultDoc: rpc("writeVaultDoc"),
    deleteVaultEntry: rpc("deleteVaultEntry"),
    renameVaultEntry: rpc("renameVaultEntry"),
    onVaultChanged: sub("onVaultChanged"),

    // Knowledge
    getBacklinks: rpc("getBacklinks"),
    getForwardLinks: rpc("getForwardLinks"),
    getLinkGraph: rpc("getLinkGraph"),
    searchVault: rpc("searchVault"),
    listWikiTargets: rpc("listWikiTargets"),
    onKnowledgeUpdated: sub("onKnowledgeUpdated"),

    // Delegation
    createDelegation: rpc("createDelegation"),
    listDelegations: rpc("listDelegations"),
    cancelDelegation: rpc("cancelDelegation"),
    restoreDelegationSnapshot: rpc("restoreDelegationSnapshot"),
    onDelegationsUpdated: sub("onDelegationsUpdated"),
    onDelegationStreamed: sub("onDelegationStreamed"),

    // Inline AI
    generateInlineAi: rpc("generateInlineAi"),
    onAiStreamed: sub("onAiStreamed"),
    cancelInlineAi: rpc("cancelInlineAi"),
    classifyAiIntent: rpc("classifyAiIntent"),
    generateGhostText: rpc("generateGhostText"),
    cancelGhostText: rpc("cancelGhostText"),
    listGhostModels: rpc("listGhostModels"),

    // Executor
    executorStatus: rpc("executorStatus"),
    listExecutorIntegrations: rpc("listExecutorIntegrations"),
    detectExecutorIntegration: rpc("detectExecutorIntegration"),
    addMcpIntegration: rpc("addMcpIntegration"),
    addOpenApiIntegration: rpc("addOpenApiIntegration"),
    addGraphqlIntegration: rpc("addGraphqlIntegration"),
    removeExecutorIntegration: rpc("removeExecutorIntegration"),
    listExecutorConnections: rpc("listExecutorConnections"),
    createExecutorConnection: rpc("createExecutorConnection"),
    removeExecutorConnection: rpc("removeExecutorConnection"),
    listExecutorOAuthClients: rpc("listExecutorOAuthClients"),
    createExecutorOAuthClient: rpc("createExecutorOAuthClient"),
    ensureGoogleOAuthClient: rpc("ensureGoogleOAuthClient"),
    registerExecutorOAuthClientDynamic: rpc("registerExecutorOAuthClientDynamic"),
    executorOAuthProbe: rpc("executorOAuthProbe"),
    executorOAuthStart: rpc("executorOAuthStart"),
    executorOAuthAwait: rpc("executorOAuthAwait"),
    executorOpenExternal: rpc("executorOpenExternal"),

    // Skills / integrations
    listSkills: rpc("listSkills"),
    listIntegrations: rpc("listIntegrations"),
    repairIntegrations: rpc("repairIntegrations"),
  };
}
