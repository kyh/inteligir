// ---------------------------------------------------------------------------
// WS server fold — serves the host's handler map + event stream over ONE
// WebSocket server. Binds loopback while remote access is disabled, 0.0.0.0
// when enabled, and rebinds when the manager's config changes (clients
// reconnect via their supervisors — that's designed-for). Every socket must
// authenticate (auth or pair frame) within 10s before any request flows.
// ---------------------------------------------------------------------------

import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { createBackoff, timeoutSchedule } from "@repo/bridge/backoff";
import { isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";
import {
  HYDRATED_EVENTS,
  REMOTE_ALLOWED_EVENTS,
  REMOTE_ALLOWED_METHODS,
  binaryChannelFor,
  binaryChannelForTag,
  type DesktopShellMethod,
  type EventMethod,
  type HostMethod,
} from "@repo/bridge/ipc-registry";
import {
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_UNAUTHORIZED,
  decodeBinaryFrame,
  encodeBinaryFrame,
  encodeFrame,
  parseClientFrame,
  type ReqFrame,
  type SendFrame,
} from "@repo/bridge/ws-protocol";
import { yieldToEventLoop } from "@repo/storage/yield-to-event-loop";
import type { HostEvents } from "../boot/create-host";
import type { WireHandler } from "../handlers/handler-registry";
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

/** The companion surface a paired remote device may reach (see the registry
 * allowlists for the rationale). The LOCAL session is exempt from both. */
const REMOTE_METHODS = new Set<string>(REMOTE_ALLOWED_METHODS);
const REMOTE_EVENTS = new Set<string>(REMOTE_ALLOWED_EVENTS);

/** Whether `session` may reach `method`/`event`. The local renderer (loopback,
 * per-boot token) reaches everything; a paired device reaches only what the
 * registry allowlists name. Fails CLOSED — a channel added to the registry is
 * unreachable from a remote device until it is allowlisted on purpose. */
function remoteMayInvoke(session: DeviceSession, method: string): boolean {
  return session.deviceId === LOCAL_DEVICE_ID || REMOTE_METHODS.has(method);
}

function remoteMayReceive(session: DeviceSession, event: string): boolean {
  return session.deviceId === LOCAL_DEVICE_ID || REMOTE_EVENTS.has(event);
}

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
  //
  // NOTHING outside resolveHandler() may read this map, and nothing outside
  // sendEvent() may push an event frame. Those two functions are the ONLY
  // places the remote-device allowlists are consulted, because scattering the
  // check is how it gets forgotten — and a forgotten check fails OPEN. Any
  // path that re-implements "look up a handler" or "write to a socket" (the
  // welcome hydration push, event broadcast, binary frames) is a hole.
  // no-ungated-dispatch.test.ts fails the build if a new caller reaches around
  // either chokepoint.
  const dispatch = new Map<string, (raw: unknown) => unknown>();
  for (const [method, handler] of Object.entries(options.host.handlers)) {
    if (handler !== undefined) dispatch.set(method, handler);
  }
  for (const [method, handler] of Object.entries(options.shellHandlers ?? {})) {
    if (handler !== undefined && !dispatch.has(method)) dispatch.set(method, handler);
  }

  /** THE inbound chokepoint. Every path that runs a handler on a session's
   * behalf — req, send, binary, and the hydration push — resolves through
   * here, so the allowlist cannot be skipped by adding a fourth caller.
   * `forbidden` and `unknown` stay distinct: callers answer a req differently,
   * and conflating them would also change what an unauthorized peer learns. */
  function resolveHandler(
    session: DeviceSession,
    method: string,
  ):
    | { ok: true; handler: (raw: unknown) => unknown }
    | { ok: false; reason: "forbidden" | "unknown" } {
    if (!remoteMayInvoke(session, method)) return { ok: false, reason: "forbidden" };
    const handler = dispatch.get(method);
    if (handler === undefined) return { ok: false, reason: "unknown" };
    return { ok: true, handler };
  }

  /** THE outbound chokepoint for host → client pushes. Broadcast and hydration
   * both land here, so an event can never reach a session the allowlist would
   * have withheld it from. `frame` is pre-encoded by the caller because a
   * broadcast encodes once and fans out to many sockets. */
  function sendEvent(
    sock: WebSocket,
    session: DeviceSession,
    method: string,
    frame: string | Uint8Array,
  ): void {
    if (!remoteMayReceive(session, method)) return;
    if (sock.readyState === WebSocket.OPEN) sock.send(frame);
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
      await yieldToEventLoop();
      if (closed) return;
      await stopServer("rebind");
      listen();
    })();
  });

  // Events fan out per SESSION, not to every authed socket: a paired device
  // must not receive the admin plane it cannot call (onRemoteAccessChanged
  // carries pairing tokens + the device roster) nor spoken note content
  // (onTtsAudio). The local renderer receives everything.
  function broadcastEvent(method: EventMethod, payload: unknown): void {
    // Registry-declared binary channels cross as [tag][bytes] instead of JSON;
    // the client reconstitutes the payload from the same declaration.
    const binary = binaryChannelFor(method);
    if (binary !== undefined) {
      const bytes = "field" in binary && isRecord(payload) ? payload[binary.field] : payload;
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return;
      const frame = encodeBinaryFrame(binary.tag, bytes);
      for (const [sock, session] of authedSockets) sendEvent(sock, session, method, frame);
      return;
    }
    const frame = encodeFrame({ t: "evt", method, payload });
    for (const [sock, session] of authedSockets) sendEvent(sock, session, method, frame);
  }

  const unsubscribeEvents = options.host.events.onAny(broadcastEvent);

  /** Push current state as evt frames for the registry's HYDRATED_EVENTS.
   * Getters resolve through the merged dispatch map, so a shell-owned
   * stateful channel would hydrate too. Best-effort: a getter that's
   * missing on this host or throws just means no push.
   *
   * Gated by the SAME allowlists as live dispatch. Hydration resolves a
   * getter server-side and pushes the result unasked, so an ungated hydrate
   * would hand a paired device exactly the admin-plane state the method gate
   * forbids it to call for (getRemoteAccessState → pairing tokens). */
  function hydrate(sock: WebSocket, session: DeviceSession): void {
    for (const [event, getter] of Object.entries(HYDRATED_EVENTS)) {
      // BOTH gates: the getter must be callable by this session AND the event
      // deliverable to it. A hydration push is a read the client never asked
      // for, so it must clear the same bar as asking.
      const resolved = resolveHandler(session, getter);
      if (!resolved.ok) continue;
      void (async () => {
        try {
          const payload = await resolved.handler(undefined);
          sendEvent(sock, session, event, encodeFrame({ t: "evt", method: event, payload }));
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
      hydrate(sock, authed);
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
      const resolved = resolveHandler(authed, frame.method);
      if (!resolved.ok) {
        const error =
          resolved.reason === "forbidden"
            ? `${frame.method} requires the local device`
            : `${frame.method} is not available on this host`;
        sock.send(encodeFrame({ t: "res", id: frame.id, ok: false, error }));
        return;
      }
      try {
        const result = await resolved.handler(frame.payload);
        sock.send(encodeFrame({ t: "res", id: frame.id, ok: true, result }));
      } catch (err) {
        // Message only — never a stack over the wire.
        sock.send(encodeFrame({ t: "res", id: frame.id, ok: false, error: toErrorMessage(err) }));
      }
    }

    function handleSend(frame: SendFrame, authed: DeviceSession): void {
      const resolved = resolveHandler(authed, frame.method);
      if (!resolved.ok) return;
      try {
        resolved.handler(frame.payload);
      } catch (err) {
        console.error(`[ws-host] send handler "${frame.method}" failed:`, err);
      }
    }

    function handleBinary(data: RawData, authed: DeviceSession): void {
      // decodeBinaryFrame yields a standalone ArrayBuffer of exactly the
      // payload bytes (handlers normalize ArrayBuffer|View).
      const decoded = decodeBinaryFrame(rawDataToView(data));
      if (decoded === null) return;
      const channel = binaryChannelForTag(decoded.tag);
      if (channel === undefined) return;
      const resolved = resolveHandler(authed, channel.method);
      if (!resolved.ok) return;
      try {
        resolved.handler(decoded.payload);
      } catch (err) {
        console.error(`[ws-host] ${channel.method} handler failed:`, err);
      }
    }

    sock.on("message", (data: RawData, isBinary: boolean) => {
      const authed = session;
      if (authed === null) {
        handlePreAuth(data, isBinary);
        return;
      }
      if (isBinary) {
        handleBinary(data, authed);
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
