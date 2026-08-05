// ---------------------------------------------------------------------------
// WS server fold — serves the host's handler map + event stream over ONE
// WebSocket server, fed by one HTTP listener per address the remote-access
// config resolves to (loopback while disabled; loopback plus the selected
// interface, or every interface, while enabled). Rebinds when the manager's
// config changes (clients reconnect via their supervisors — that's
// designed-for). Every socket must authenticate (auth or pair frame) within
// 10s before any request flows.
// ---------------------------------------------------------------------------

import http, { type IncomingMessage } from "node:http";
import os from "node:os";
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
import { LOOPBACK_ADDRESS, resolveBindHosts, type InterfaceTable } from "./network-endpoints";
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
  /** The OS interface table, read afresh on every bind. Injected so tests can
   * pin an address list that would otherwise depend on the box's NICs;
   * production has no reason to set it. */
  networkInterfaces?: () => InterfaceTable;
};

export type WsHost = {
  /** Actual bound port, or null while not listening. */
  port: () => number | null;
  close: () => Promise<void>;
};

/** A live bind: the one ws server plus the HTTP listeners feeding it upgrades
 * (one per bound address — see `listen`). */
type LiveServer = {
  readonly wss: WebSocketServer;
  readonly listeners: readonly http.Server[];
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

/** The CONFIG a bind was asked for — never the resolved address list, which is
 * recomputed from the live interface table on every bind attempt. Comparing
 * configs is what distinguishes "the user changed something" from "the machine
 * moved networks under us"; only the former is a rebind. */
type BindTarget = {
  readonly enabled: boolean;
  readonly bindAddress: string;
  readonly port: number;
  /** Bumped by every setConfig, so re-selecting the address already pinned
   * counts as a change. It has to: a pin whose address was absent at bind time
   * degraded to loopback, and asking for it again is the user's only way to
   * pick it up once the interface appears. */
  readonly revision: number;
};

function sameBind(a: BindTarget, b: BindTarget): boolean {
  return (
    a.enabled === b.enabled &&
    a.bindAddress === b.bindAddress &&
    a.port === b.port &&
    a.revision === b.revision
  );
}

/** Release the bound ports. `close()` drops the listening handle
 * synchronously, so the port is free for an immediate rebind; its callback
 * (which waits on sockets already upgraded away from HTTP) is nothing a
 * rebind needs to wait for — the ws server's own close covers those. */
function stopListeners(listeners: readonly http.Server[]): void {
  for (const listener of listeners) listener.close();
}

function bindListener(wss: WebSocketServer, host: string, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const listener = http.createServer((_request, response) => {
      response.writeHead(426, { "content-type": "text/plain" });
      response.end("upgrade required");
    });
    listener.on("upgrade", (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (sock) => {
        wss.emit("connection", sock, request);
      });
    });
    const onError = (err: Error): void => {
      listener.removeListener("listening", onListening);
      listener.close();
      reject(err);
    };
    const onListening = (): void => {
      listener.removeListener("error", onError);
      // A BOUND listener with no `error` listener turns any later async error
      // into an unhandled `error` event, which takes the process down — and
      // the real teardown handler cannot be attached until every address in
      // the attempt has resolved. This one holds the gap and stays underneath
      // it afterwards.
      listener.on("error", (err) => {
        console.error(`[ws-host] listener error on ${host}:`, err);
      });
      resolve(listener);
    };
    listener.once("error", onError);
    listener.once("listening", onListening);
    listener.listen(port, host);
  });
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

  let server: LiveServer | null = null;
  let actualPort: number | null = null;
  let closed = false;
  // The bind in flight, or null. `server` is only set once the addresses are
  // bound, so this is what a concurrent caller must AWAIT rather than drop:
  // returning early would let `close()` resolve — or a rebind proceed — while
  // an untracked listener is still coming up.
  let binding: Promise<void> | null = null;
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

  const readInterfaces = options.networkInterfaces ?? (() => os.networkInterfaces());

  function desiredBind(): BindTarget {
    const { enabled, bindAddress, port, revision } = options.manager.getConfig();
    return { enabled, bindAddress, port, revision };
  }

  /** The bind the CONFIG currently asks for (config values, so an ephemeral
   * `port: 0` stays 0 here) — compared against config on every manager change
   * to decide rebinds, and re-checked after a bind lands so a config change
   * that raced it is not silently served by the previous target. Deliberately
   * NOT cleared when the live server dies: recovery from a failed bind is the
   * retry loop's job, and a config change must still be recognizable as one. */
  let targetBind = desiredBind();

  /** Queue `work` behind everything already queued. EVERY bind and teardown
   * goes through here — including the backoff retry, which is the one that
   * used to run outside the chain and could install a listener against a
   * target the user had already changed. */
  function enqueue(work: () => Promise<void>): Promise<void> {
    const previous = rebindChain;
    const next = (async () => {
      await previous;
      await work();
    })();
    // The chain the queue and close() both await must never carry a rejection:
    // one throw would reject every later enqueue and close() itself, wedging
    // the transport with no way to rebind. Nothing throws today (bindOnce
    // catches its binds, stopServer always resolves), so this is a guard on
    // the invariant rather than a live path.
    rebindChain = next.catch((err: unknown) => {
      console.error("[ws-host] rebind chain failed:", err);
    });
    return next;
  }

  function clearRetry(): void {
    rebindBackoff.cancel();
    rebindBackoff.reset();
  }

  function scheduleRetry(): void {
    if (closed) return;
    rebindBackoff.schedule(() => void enqueue(() => listen()));
  }

  function tearDown(live: LiveServer, err: unknown): void {
    console.error("[ws-host] server error:", err);
    // The server is dead — drop it so a retry (or config change) binds fresh.
    server = null;
    actualPort = null;
    for (const sock of live.wss.clients) sock.terminate();
    authedSockets.clear();
    live.wss.close();
    stopListeners(live.listeners);
    options.manager.setListening(false, null, toErrorMessage(err));
    if (everListened) scheduleRetry();
  }

  /** A bind that came up but has not been committed as `server` yet. */
  type BindAttempt = {
    readonly wss: WebSocketServer;
    readonly listeners: readonly http.Server[];
    readonly port: number;
    /** The addresses that actually came up — what `commit` hands the manager,
     * so nothing downstream has to re-derive reachability from the config. */
    readonly hosts: readonly string[];
    /** A non-primary address that failed while the primary one came up.
     * Reported, never fatal. */
    readonly extraError: string | null;
  };

  /** Throw away a ws server + its listeners without touching `server` — for a
   * bind that must not be kept (closed mid-flight, or superseded). */
  function discard(attempt: BindAttempt): void {
    for (const sock of attempt.wss.clients) sock.terminate();
    attempt.wss.close();
    stopListeners(attempt.listeners);
  }

  /** One bind pass, or null if the PRIMARY address failed — already reported,
   * with a retry scheduled where one is warranted. */
  async function bindOnce(bind: BindTarget): Promise<BindAttempt | null> {
    // Resolved HERE, per attempt, against the LIVE interface table — never
    // from a list captured when the config changed. A pinned address can
    // vanish between the two (the overlay drops, the laptop sleeps or roams),
    // and replaying a stale list would rebind the same dead host on every
    // retry, forever.
    const hosts = resolveBindHosts(bind, readInterfaces());
    const [primary = LOOPBACK_ADDRESS, ...extra] = hosts;
    // One ws server fed by one HTTP listener PER BOUND ADDRESS. A socket binds
    // exactly one address, and remote access may be pinned to a single
    // interface (a Tailscale address) while the desktop's own renderer still
    // dials 127.0.0.1 every launch — so loopback gets its own listener.
    // `noServer` keeps both listeners upgrading into the SAME ws server, so
    // client tracking, the liveness sweep and teardown stay single-sourced.
    const wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: MAX_PAYLOAD_BYTES,
    });
    // Attached before the first bind: an upgrade can land while a later
    // address is still binding, and a connection nobody handles is a socket
    // that never authenticates and never closes.
    wss.on("connection", handleConnection);
    const listeners: http.Server[] = [];
    const bound: string[] = [];
    let port = bind.port;
    try {
      const listener = await bindListener(wss, primary, port);
      const address = listener.address();
      // An ephemeral `port: 0` resolves on the FIRST bind; every later
      // address joins that port so one URL is valid everywhere.
      if (typeof address === "object" && address !== null) port = address.port;
      listeners.push(listener);
      bound.push(primary);
    } catch (err) {
      wss.close();
      options.manager.setListening(false, null, toErrorMessage(err));
      if (everListened) scheduleRetry();
      return null;
    }
    // `resolveBindHosts` puts loopback first, and every address after it is
    // BEST EFFORT: binding an unassigned IPv4 fails EADDRNOTAVAIL, and the
    // desktop's own renderer must never lose its socket because a remote
    // address went away.
    let extraError: string | null = null;
    for (const host of extra) {
      try {
        listeners.push(await bindListener(wss, host, port));
        bound.push(host);
      } catch (err) {
        extraError = `${host}: ${toErrorMessage(err)}`;
      }
    }
    return { wss, listeners, port, hosts: bound, extraError };
  }

  function commit(attempt: BindAttempt): void {
    const live: LiveServer = { wss: attempt.wss, listeners: attempt.listeners };
    server = live;
    actualPort = attempt.port;
    everListened = true;
    clearRetry();
    // A post-bind error on ANY listener tears the whole server down, including
    // loopback — but the retry that follows re-resolves the host list, so a
    // pinned address that died comes back as a loopback-only bind within a
    // backoff tick rather than wedging the renderer out.
    for (const listener of attempt.listeners) {
      listener.on("error", (err) => {
        if (server !== live) return;
        tearDown(live, err);
      });
    }
    // Liveness sweep. `responsive` is refreshed by every pong (ws answers our
    // protocol ping automatically on the peer side, so this needs no cooperation
    // from the client protocol). A socket still unmarked one full interval after
    // we pinged it never answered, so it is gone.
    const pingTimer = setInterval(() => {
      for (const sock of live.wss.clients) {
        if (!responsive.delete(sock)) {
          sock.terminate();
          continue;
        }
        sock.ping();
      }
    }, options.pingIntervalMs ?? PING_INTERVAL_MS);
    // Fires for both teardown paths (stopServer and tearDown both call
    // wss.close()), so the timer can never outlive its server.
    live.wss.on("close", () => clearInterval(pingTimer));
    options.manager.setListening(true, attempt.port, attempt.extraError, attempt.hosts);
  }

  async function bindUntilCurrent(): Promise<void> {
    for (;;) {
      if (closed || server !== null) return;
      const bind = desiredBind();
      const attempt = await bindOnce(bind);
      if (attempt === null) return;
      if (closed) {
        discard(attempt);
        options.manager.setListening(false, null);
        return;
      }
      // A config change that landed mid-bind must not be served by the
      // listeners the PREVIOUS one asked for: drop them and go round again
      // against the address the user now wants.
      if (!sameBind(bind, targetBind)) {
        discard(attempt);
        continue;
      }
      commit(attempt);
      return;
    }
  }

  /** Bind unless something is already up. A concurrent caller gets the
   * IN-FLIGHT promise rather than a silent no-op, so `close()` and the rebind
   * chain always await a bind instead of racing an untracked one. */
  function listen(): Promise<void> {
    const inFlight = binding;
    if (inFlight !== null) return inFlight;
    const started = bindUntilCurrent().finally(() => {
      binding = null;
    });
    binding = started;
    return started;
  }

  async function stopServer(mode: "rebind" | "final"): Promise<void> {
    clearRetry();
    const live = server;
    server = null;
    actualPort = null;
    authedSockets.clear();
    if (live === null) return;
    // Stop accepting before draining, so nothing new lands mid-teardown.
    stopListeners(live.listeners);
    let graceTimer: NodeJS.Timeout | null = null;
    if (mode === "final") {
      for (const sock of live.wss.clients) sock.terminate();
    } else {
      for (const sock of live.wss.clients) sock.close(WS_CLOSE_SERVICE_RESTART, "service restart");
      graceTimer = setTimeout(() => {
        for (const sock of live.wss.clients) sock.terminate();
      }, REBIND_CLOSE_GRACE_MS);
    }
    await new Promise<void>((resolve) => {
      live.wss.close(() => resolve());
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
    if (sameBind(bind, targetBind)) return;
    targetBind = bind;
    void enqueue(async () => {
      // Defer past the current turn's microtasks: the res frame answering the
      // config change that triggered this rebind (and the just-broadcast evt
      // frame) must reach the socket before it starts closing.
      await yieldToEventLoop();
      if (closed) return;
      await stopServer("rebind");
      await listen();
    });
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

  // Seeds the chain so a config change (or close) queues behind the first bind
  // instead of racing it.
  rebindChain = listen();

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
