// ---------------------------------------------------------------------------
// WS server fold — serves the host's handler map + event stream over ONE
// WebSocket server. Binds loopback while remote access is disabled, 0.0.0.0
// when enabled, and rebinds when the manager's config changes (clients
// reconnect via their supervisors — that's designed-for). Every socket must
// authenticate (auth or pair frame) within 10s before any request flows.
// ---------------------------------------------------------------------------

import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { createBackoff, timeoutSchedule } from "@repo/features/backoff";
import { isRecord, toErrorMessage } from "@repo/features/ipc";
import {
  HYDRATED_EVENTS,
  LOCAL_ONLY_METHODS,
  type DesktopShellMethod,
  type EventMethod,
  type HostMethod,
} from "@repo/features/ipc-registry";
import {
  BINARY_STT_AUDIO,
  BINARY_TTS_AUDIO,
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_UNAUTHORIZED,
  decodeBinaryFrame,
  encodeBinaryFrame,
  encodeFrame,
  parseClientFrame,
  type ReqFrame,
  type SendFrame,
} from "@repo/features/ws-protocol";
import type { HostEvents } from "../create-host";
import type { WireHandler } from "../lib/handler-registry";
import { LOCAL_DEVICE_ID, type DeviceSession, type TokenValidator } from "./device-auth";
import type { RemoteAccessManager } from "./remote-access-manager";

// writeVaultAsset ships base64 image bytes in a single frame.
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const AUTH_DEADLINE_MS = 10_000;
// Pre-auth DoS bounds: auth/pair frames are ~100 bytes, so anything bigger is
// not a client we want to buffer/parse/hash while unauthenticated — and only
// a handful of sockets may sit unauthenticated at once.
const PRE_AUTH_MAX_FRAME_BYTES = 4 * 1024;
const PRE_AUTH_MAX_SOCKETS = 8;
// A mid-session rebind failure (port stolen in the close→listen gap) retries
// with backoff until a bind lands or the config changes again.
const REBIND_RETRY_BASE_MS = 1_000;
const REBIND_RETRY_CAP_MS = 30_000;
// On rebind, sockets get a graceful close so already-queued frames (the res
// answering the very config change that triggered it) flush; stragglers that
// never finish the close handshake are terminated after this grace window.
const REBIND_CLOSE_GRACE_MS = 2_000;
// A peer that vanishes without a close handshake — slept laptop, yanked cable,
// killed app — leaves a half-open socket that TCP alone may not notice for the
// better part of an hour, holding an authed session open and making us write
// frames into the void. Ping on an interval; a socket that misses a whole
// interval without answering is unreachable and gets terminated (which fires
// `close`, releasing its authed session like any other disconnect).
const PING_INTERVAL_MS = 30_000;

// Standard WebSocket close codes (RFC 6455) used by the pre-auth bounds and
// the rebind path; the 44xx app codes live in ws-protocol.
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
const WS_CLOSE_SERVICE_RESTART = 1012;
const WS_CLOSE_TRY_AGAIN_LATER = 1013;

/** The slice of Host the ws transport consumes — a real `Host` (create-host)
 * assigns directly. The handler map may be partial (tests, shells that stub):
 * a missing method answers `{ok:false}`, never a crash. */
export type WsHostSource = {
  readonly handlers: Readonly<Partial<Record<HostMethod, WireHandler>>>;
  readonly events: HostEvents;
};

export type WsHostOptions = {
  host: WsHostSource;
  validator: TokenValidator;
  manager: RemoteAccessManager;
  /** Shell-owned methods (html-app token mint/revoke) the platform-agnostic
   * host has no handler for; host handlers win on overlap. */
  shellHandlers?: Partial<Record<DesktopShellMethod, (raw: unknown) => unknown>>;
  /** Liveness ping cadence. Exists so tests can drive the sweep without waiting
   * out the real interval; production has no reason to set it. */
  pingIntervalMs?: number;
};

export type WsHost = {
  /** Actual bound port, or null while not listening. */
  port: () => number | null;
  close: () => Promise<void>;
};

/** Admin-plane methods only the local session may dispatch (see the registry
 * partition for the rationale). */
const LOCAL_ONLY = new Set<string>(LOCAL_ONLY_METHODS);

function rawDataToView(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Buffer.concat(data);
}

/** Decode a text frame WITHOUT copying it: Buffers stringify directly, and a
 * bare view is wrapped (offset + length, no clone) before stringifying. */
function viewToString(view: Uint8Array): string {
  return Buffer.isBuffer(view)
    ? view.toString("utf8")
    : Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("utf8");
}

function rawDataToString(data: RawData): string {
  return viewToString(rawDataToView(data));
}

// Belt + braces on top of token auth: browsers attach the page's Origin, so
// rejecting non-local origins stops a hostile web page from even reaching the
// auth exchange. Native clients (and Electron's file:// pages) send no Origin
// or a file: one — both fine.
function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  if (origin === "file://") return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol === "file:") return true;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function startWsHost(options: WsHostOptions): WsHost {
  // One flat dispatch map: host handlers first, shell handlers fill the
  // methods the platform-agnostic host doesn't own.
  const dispatch = new Map<string, (raw: unknown) => unknown>();
  for (const [method, handler] of Object.entries(options.host.handlers)) {
    if (handler !== undefined) dispatch.set(method, handler);
  }
  for (const [method, handler] of Object.entries(options.shellHandlers ?? {})) {
    if (handler !== undefined && !dispatch.has(method)) dispatch.set(method, handler);
  }

  let server: WebSocketServer | null = null;
  let actualPort: number | null = null;
  let closed = false;
  // Set on the first successful bind: the initial boot bind is fail-fast (the
  // shell surfaces a fatal dialog off the manager's listen error), while a
  // later rebind failure retries with backoff.
  let everListened = false;
  const rebindBackoff = createBackoff({
    baseMs: REBIND_RETRY_BASE_MS,
    capMs: REBIND_RETRY_CAP_MS,
    schedule: timeoutSchedule,
  });
  // Serializes rebinds so overlapping config changes can't race two servers.
  let rebindChain: Promise<void> = Promise.resolve();
  const authedSockets = new Map<WebSocket, DeviceSession>();
  /** Sockets that have answered (or not yet been asked) since the last sweep.
   *  Weak so a terminated socket needs no explicit cleanup here. */
  const responsive = new WeakSet<WebSocket>();
  let preAuthCount = 0;

  function desiredBind(): { host: string; port: number } {
    const config = options.manager.getConfig();
    return { host: config.enabled ? "0.0.0.0" : "127.0.0.1", port: config.port };
  }

  /** The bind the CONFIG currently asks for (config values, so an ephemeral
   * `port: 0` stays 0 here) — compared against config on every manager change
   * to decide rebinds. Deliberately NOT cleared when the live server dies:
   * recovery from a failed bind is the retry loop's job, and a config change
   * must still be recognizable as one. */
  let targetBind = desiredBind();

  function clearRetry(): void {
    rebindBackoff.cancel();
    rebindBackoff.reset();
  }

  function scheduleRetry(): void {
    if (closed) return;
    rebindBackoff.schedule(listen);
  }

  function listen(): void {
    if (closed || server !== null) return;
    const bind = targetBind;
    const wss = new WebSocketServer({
      host: bind.host,
      port: bind.port,
      perMessageDeflate: false,
      maxPayload: MAX_PAYLOAD_BYTES,
    });
    server = wss;
    wss.on("listening", () => {
      if (wss !== server) return;
      everListened = true;
      clearRetry();
      const address = wss.address();
      actualPort = typeof address === "object" && address !== null ? address.port : bind.port;
      options.manager.setListening(true, actualPort);
    });
    wss.on("error", (err) => {
      if (wss !== server) return;
      console.error("[ws-host] server error:", err);
      // The server is dead — drop it so a retry (or config change) binds fresh.
      server = null;
      actualPort = null;
      for (const sock of wss.clients) sock.terminate();
      authedSockets.clear();
      wss.close(() => {});
      options.manager.setListening(false, null, toErrorMessage(err));
      if (everListened) scheduleRetry();
    });
    // Liveness sweep. `responsive` is refreshed by every pong (ws answers our
    // protocol ping automatically on the peer side, so this needs no cooperation
    // from the client protocol). A socket still unmarked one full interval after
    // we pinged it never answered, so it is gone.
    const pingTimer = setInterval(() => {
      for (const sock of wss.clients) {
        if (!responsive.delete(sock)) {
          sock.terminate();
          continue;
        }
        sock.ping();
      }
    }, options.pingIntervalMs ?? PING_INTERVAL_MS);
    // Fires for both teardown paths (stopServer and the error handler both call
    // wss.close()), so the timer can never outlive its server.
    wss.on("close", () => clearInterval(pingTimer));

    wss.on("connection", handleConnection);
  }

  async function stopServer(mode: "rebind" | "final"): Promise<void> {
    clearRetry();
    const wss = server;
    server = null;
    actualPort = null;
    authedSockets.clear();
    if (wss === null) return;
    let graceTimer: NodeJS.Timeout | null = null;
    if (mode === "final") {
      for (const sock of wss.clients) sock.terminate();
    } else {
      for (const sock of wss.clients) sock.close(WS_CLOSE_SERVICE_RESTART, "service restart");
      graceTimer = setTimeout(() => {
        for (const sock of wss.clients) sock.terminate();
      }, REBIND_CLOSE_GRACE_MS);
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    if (graceTimer !== null) clearTimeout(graceTimer);
    options.manager.setListening(false, null);
  }

  const unsubscribeManager = options.manager.onChange((state) => {
    if (closed) return;
    // Revocation must kill the LIVE socket too, not just future auths: any
    // authed device the store no longer knows gets closed 4401. The local
    // per-boot session is exempt (it is never in the device store).
    const known = new Set(state.devices.map((device) => device.id));
    for (const [sock, session] of authedSockets) {
      if (session.deviceId === LOCAL_DEVICE_ID) continue;
      if (!known.has(session.deviceId)) {
        authedSockets.delete(sock);
        sock.close(WS_CLOSE_UNAUTHORIZED, "device revoked");
      }
    }
    const bind = desiredBind();
    if (bind.host === targetBind.host && bind.port === targetBind.port) return;
    targetBind = bind;
    const previous = rebindChain;
    rebindChain = (async () => {
      await previous;
      // Defer past the current turn's microtasks: the res frame answering the
      // config change that triggered this rebind (and the just-broadcast evt
      // frame) must reach the socket before it starts closing.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (closed) return;
      await stopServer("rebind");
      listen();
    })();
  });

  function broadcastEvent(method: EventMethod, payload: unknown): void {
    if (method === "onTtsAudio") {
      // Audio crosses as a tag-2 binary frame; the client reconstitutes
      // `{ audio: ArrayBuffer }` for its onTtsAudio listeners.
      const audio = isRecord(payload) ? payload["audio"] : null;
      if (!(audio instanceof ArrayBuffer) && !ArrayBuffer.isView(audio)) return;
      const frame = encodeBinaryFrame(BINARY_TTS_AUDIO, audio);
      for (const sock of authedSockets.keys()) {
        if (sock.readyState === WebSocket.OPEN) sock.send(frame);
      }
      return;
    }
    const frame = encodeFrame({ t: "evt", method, payload });
    for (const sock of authedSockets.keys()) {
      if (sock.readyState === WebSocket.OPEN) sock.send(frame);
    }
  }

  const unsubscribeEvents = options.host.events.onAny(broadcastEvent);

  /** Push current state as evt frames for the registry's HYDRATED_EVENTS.
   * Getters resolve through the merged dispatch map, so a shell-owned
   * stateful channel would hydrate too. Best-effort: a getter that's
   * missing on this host or throws just means no push. */
  function hydrate(sock: WebSocket): void {
    for (const [event, getter] of Object.entries(HYDRATED_EVENTS)) {
      const handler = dispatch.get(getter);
      if (handler === undefined) continue;
      void (async () => {
        try {
          const payload = await handler(undefined);
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(encodeFrame({ t: "evt", method: event, payload }));
          }
        } catch {
          // Hydration never breaks the connection it heals.
        }
      })();
    }
  }

  function handleConnection(sock: WebSocket, request: IncomingMessage): void {
    if (!originAllowed(request.headers.origin)) {
      sock.close(WS_CLOSE_FORBIDDEN_ORIGIN, "origin not allowed");
      return;
    }
    if (preAuthCount >= PRE_AUTH_MAX_SOCKETS) {
      sock.close(WS_CLOSE_TRY_AGAIN_LATER, "too many pending connections");
      return;
    }
    // Starts responsive so the first sweep pings rather than terminates it, and
    // every pong re-marks it. A peer that stops answering falls out of the set
    // and the next sweep reaps it.
    responsive.add(sock);
    sock.on("pong", () => responsive.add(sock));

    preAuthCount += 1;
    let preAuthHeld = true;
    const releasePreAuth = (): void => {
      if (!preAuthHeld) return;
      preAuthHeld = false;
      preAuthCount -= 1;
    };

    let session: DeviceSession | null = null;
    const deadline = setTimeout(() => {
      sock.close(WS_CLOSE_UNAUTHORIZED, "authentication deadline elapsed");
    }, AUTH_DEADLINE_MS);

    function welcome(authed: DeviceSession): void {
      session = authed;
      clearTimeout(deadline);
      releasePreAuth();
      authedSockets.set(sock, authed);
      if (authed.deviceId !== LOCAL_DEVICE_ID) {
        try {
          options.manager.touchDevice(authed.deviceId);
        } catch {
          // lastSeenAt is best-effort bookkeeping.
        }
      }
      sock.send(encodeFrame({ t: "welcome" }));
      hydrate(sock);
    }

    function handlePreAuth(data: RawData, isBinary: boolean): void {
      if (isBinary) {
        sock.close(WS_CLOSE_POLICY_VIOLATION, "binary frame before auth");
        return;
      }
      const view = rawDataToView(data);
      if (view.byteLength > PRE_AUTH_MAX_FRAME_BYTES) {
        sock.close(WS_CLOSE_MESSAGE_TOO_BIG, "pre-auth frame too large");
        return;
      }
      const frame = parseClientFrame(viewToString(view));
      if (frame === null) {
        sock.close(WS_CLOSE_UNAUTHORIZED, "malformed frame");
        return;
      }
      if (frame.t === "auth") {
        const result = options.validator.validate(frame.token);
        if (result === null) {
          sock.close(WS_CLOSE_UNAUTHORIZED, "invalid token");
          return;
        }
        welcome(result);
        return;
      }
      if (frame.t === "pair") {
        const result = options.manager.redeemPairingToken(frame.pairingToken, frame.deviceName);
        if (!result.ok) {
          sock.close(WS_CLOSE_UNAUTHORIZED, result.error);
          return;
        }
        sock.send(
          encodeFrame({ t: "paired", deviceToken: result.deviceToken, deviceId: result.deviceId }),
        );
        welcome({ deviceId: result.deviceId, name: frame.deviceName });
        return;
      }
      sock.close(WS_CLOSE_UNAUTHORIZED, "not authenticated");
    }

    async function handleReq(frame: ReqFrame, authed: DeviceSession): Promise<void> {
      if (LOCAL_ONLY.has(frame.method) && authed.deviceId !== LOCAL_DEVICE_ID) {
        sock.send(
          encodeFrame({
            t: "res",
            id: frame.id,
            ok: false,
            error: `${frame.method} requires the local device`,
          }),
        );
        return;
      }
      const handler = dispatch.get(frame.method);
      if (handler === undefined) {
        sock.send(
          encodeFrame({
            t: "res",
            id: frame.id,
            ok: false,
            error: `${frame.method} is not available on this host`,
          }),
        );
        return;
      }
      try {
        const result = await handler(frame.payload);
        sock.send(encodeFrame({ t: "res", id: frame.id, ok: true, result }));
      } catch (err) {
        // Message only — never a stack over the wire.
        sock.send(encodeFrame({ t: "res", id: frame.id, ok: false, error: toErrorMessage(err) }));
      }
    }

    function handleSend(frame: SendFrame, authed: DeviceSession): void {
      if (LOCAL_ONLY.has(frame.method) && authed.deviceId !== LOCAL_DEVICE_ID) return;
      const handler = dispatch.get(frame.method);
      if (handler === undefined) return;
      try {
        handler(frame.payload);
      } catch (err) {
        console.error(`[ws-host] send handler "${frame.method}" failed:`, err);
      }
    }

    function handleBinary(data: RawData): void {
      // decodeBinaryFrame yields a standalone ArrayBuffer of exactly the PCM
      // bytes (the existing handler normalizes ArrayBuffer|View).
      const decoded = decodeBinaryFrame(rawDataToView(data));
      if (decoded === null || decoded.tag !== BINARY_STT_AUDIO) return;
      const handler = dispatch.get("sendSttAudio");
      if (handler === undefined) return;
      try {
        handler(decoded.payload);
      } catch (err) {
        console.error("[ws-host] sendSttAudio handler failed:", err);
      }
    }

    sock.on("message", (data: RawData, isBinary: boolean) => {
      const authed = session;
      if (authed === null) {
        handlePreAuth(data, isBinary);
        return;
      }
      if (isBinary) {
        handleBinary(data);
        return;
      }
      const frame = parseClientFrame(rawDataToString(data));
      if (frame === null) return;
      if (frame.t === "req") {
        void handleReq(frame, authed);
        return;
      }
      if (frame.t === "send") handleSend(frame, authed);
    });
    sock.on("close", () => {
      clearTimeout(deadline);
      releasePreAuth();
      authedSockets.delete(sock);
    });
    sock.on("error", (err) => {
      console.error("[ws-host] socket error:", err);
    });
  }

  listen();

  return {
    port: () => actualPort,
    close: async () => {
      if (closed) return;
      closed = true;
      unsubscribeManager();
      unsubscribeEvents();
      clearRetry();
      await rebindChain;
      await stopServer("final");
    },
  };
}
