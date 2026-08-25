// The `/voice/stream` connections, their bounds, and their teardown by name.
//
// A dictation socket is HIJACKED off the HTTP server the moment it upgrades, so
// `server.close()` never completes while one is open and `closeAllConnections()`
// does not touch it — the exact trap `CLAUDE.md`'s shutdown decision records for
// `/ws`. So this hub tracks every open connection and the listener teardown step
// drains them the SAME way the invalidation bus does: `closeAllClients` only
// SENDS the going-away frame and keeps the connection registered, then a bounded
// drain, then `terminateAllClients` destroys whatever ignored it. Forgetting a
// connection happens on its REAL close (or in the idle reap), never inside
// `closeAllClients` — a synchronous forget there empties the set before the
// terminate pass can reach the stuck socket, which is the bug this shape fixes.
//
// TWO BOUNDS on the persistent worker. Each session loads the ~106 MB model up
// front, on the process that owns the database and the watcher, so (a) the hub
// caps concurrent sessions and refuses opens past it, and (b) each connection
// idle-reaps: a live hold sends a frame every ~128 ms, so no frame for the idle
// window means the peer is gone (killed tab, dropped network) even though
// `onClose` never fired — `@hono/node-ws` runs no ping/pong, so the audio itself
// is the heartbeat.
//
// The hub OWNS the binding: `open` mints the session (a real worker, or the
// scripted fake) and wires its partials/final/error onto the socket, so the
// route handler only forwards frames and closes.

import {
  VOICE_STREAM_FRAME_MAX_BYTES,
  voiceStreamUpMessageSchema,
  type VoiceStreamDownMessage,
} from "@repo/api/local/voice/voice-schema";
import { z } from "zod";
import type { UpgradedSockets } from "../listen";
import { terminateTransport } from "../ws-bus";
import type { StreamSession } from "./stream-session";
import type { VoiceService } from "./voice-service";

/** The websocket surface the hub drives — hono's WSContext satisfies it, tests
 *  hand in a scriptable fake. */
export interface VoiceStreamSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  readonly raw?: unknown;
}

/** What a frame handler receives from `@hono/node-ws`: text, or (binary) an
 *  ArrayBuffer. Blob and shared buffers are in the union a transport MAY
 *  produce; the handler ignores them rather than guessing. */
export type VoiceStreamFrame = string | Blob | ArrayBufferLike;

/**
 * The most dictation sessions open at once. One live mic plus headroom for a
 * stale session still tearing down as a new one opens; past this, an open is a
 * loop or a leak, and each session is ~106 MB of model on the process that owns
 * the db and the watcher — so it is refused rather than spawned.
 */
export const MAX_CONCURRENT_STREAM_SESSIONS = 3;

/**
 * No frame for this long means the peer is gone. A live hold sends audio every
 * ~128 ms, so this cannot fire during a real recording; it only catches a
 * half-open socket whose `onClose` never arrives, whose worker would otherwise
 * leak for the process's life.
 */
export const STREAM_IDLE_TIMEOUT_MS = 10_000;

const SOCKET_OPEN_STATE = 1;
/** RFC 6455 normal closure — a session that finished. */
const NORMAL_CLOSE_CODE = 1000;
/** RFC 6455 "going away" — a server shutting down owes the client this so the
 *  page can tell a deliberate stop from a dropped connection. */
const GOING_AWAY_CLOSE_CODE = 1001;
/** RFC 6455 policy violation — the refused-over-cap close. */
const POLICY_CLOSE_CODE = 1008;

export class VoiceStreamConnection {
  readonly #socket: VoiceStreamSocket;
  readonly #forget: (connection: VoiceStreamConnection) => void;
  #session: StreamSession | null = null;
  #disposed = false;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(socket: VoiceStreamSocket, forget: (connection: VoiceStreamConnection) => void) {
    this.#socket = socket;
    this.#forget = forget;
  }

  bind(session: StreamSession): void {
    // A dispose that raced the bind (the socket closed before the session
    // existed) still tears the session down.
    if (this.#disposed) {
      void session.dispose();
      return;
    }
    this.#session = session;
    this.#armIdle();
  }

  #armIdle(): void {
    this.#clearIdle();
    this.#idleTimer = setTimeout(() => this.#reapIdle(), STREAM_IDLE_TIMEOUT_MS);
    // `unref` so an idle session's own timer never keeps the process alive.
    this.#idleTimer.unref?.();
  }

  #clearIdle(): void {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }

  #reapIdle(): void {
    // The peer stopped sending audio without closing — destroy the transport
    // (its onClose may never come) and reap the worker.
    this.terminate();
    void this.dispose();
  }

  send(message: VoiceStreamDownMessage): void {
    if (this.#socket.readyState === SOCKET_OPEN_STATE) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  /** Refuse this connection before any session is minted (over the cap). */
  refuse(message: string): void {
    this.send({ type: "error", message });
    this.#close(POLICY_CLOSE_CODE);
  }

  /** A frame off the wire: a control message (text) or a PCM16 chunk (binary). */
  receive(frame: VoiceStreamFrame): void {
    // Every frame is a heartbeat — a live hold keeps this connection alive.
    this.#armIdle();
    const asText = z.string().safeParse(frame);
    if (asText.success) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(asText.data);
      } catch {
        return;
      }
      const parsed = voiceStreamUpMessageSchema.safeParse(decoded);
      if (parsed.success && parsed.data.type === "finalize") {
        this.#session?.finalize();
      }
      return;
    }
    if (!(frame instanceof ArrayBuffer)) {
      return;
    }
    // Whole 16-bit samples, and no larger than one second of them — a frame past
    // that is a misbehaving client, not audio.
    if (
      frame.byteLength === 0 ||
      frame.byteLength % 2 !== 0 ||
      frame.byteLength > VOICE_STREAM_FRAME_MAX_BYTES
    ) {
      return;
    }
    // The buffer arrives owned (node-ws slices binary frames), so it is handed
    // straight to the session, which transfers it into the worker.
    this.#session?.pushPcm(frame);
  }

  /** Close the socket after a final or an error; its onClose disposes us. */
  close(): void {
    this.#close(NORMAL_CLOSE_CODE);
  }

  #close(code: number, reason?: string): void {
    this.#clearIdle();
    try {
      this.#socket.close(code, reason);
    } catch {
      // Already closing; dispose / the terminate pass is the backstop.
    }
  }

  /**
   * Shutdown: tell the client the server is going away and reap the worker, but
   * do NOT forget this connection — the terminate pass must still reach a socket
   * that ignores this frame. Forgetting happens on the real close.
   */
  goAway(): void {
    this.#close(GOING_AWAY_CLOSE_CODE, "server-shutting-down");
    const session = this.#session;
    this.#session = null;
    void session?.dispose();
  }

  /** Destroy a transport that ignored its close frame. */
  terminate(): void {
    terminateTransport(this.#socket);
  }

  /** Tear the worker down and forget this connection. Idempotent — the socket's
   *  onClose, a final, an error and the idle reap all reach it. */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#clearIdle();
    this.#forget(this);
    const session = this.#session;
    this.#session = null;
    await session?.dispose();
  }
}

/**
 * Tracks the open dictation sockets, bounds them, and implements the teardown
 * seam `closeServer` drains. Folded beside the invalidation bus in the listener
 * step so a live hold cannot stall the process's exit.
 */
export class VoiceStreamHub implements UpgradedSockets {
  readonly #voice: VoiceService;
  readonly #connections = new Set<VoiceStreamConnection>();

  constructor(voice: VoiceService) {
    this.#voice = voice;
  }

  /** How many sessions are open — for tests and for the cap. */
  get size(): number {
    return this.#connections.size;
  }

  /** Register a freshly upgraded socket and mint its session. Over the cap, the
   *  socket is refused with an error frame and no worker is spawned. */
  open(socket: VoiceStreamSocket): VoiceStreamConnection {
    const connection = new VoiceStreamConnection(socket, (c) => this.#connections.delete(c));
    if (this.#connections.size >= MAX_CONCURRENT_STREAM_SESSIONS) {
      connection.refuse("Too many dictation sessions are open. Stop another and try again.");
      return connection;
    }
    this.#connections.add(connection);
    const session = this.#voice.createStreamSession({
      onPartial: (text) => connection.send({ type: "partial", text }),
      onFinal: (text) => {
        connection.send({ type: "final", text });
        connection.close();
      },
      onError: (message) => {
        connection.send({ type: "error", message });
        connection.close();
      },
    });
    connection.bind(session);
    return connection;
  }

  /** Shutdown step one: send every client the going-away frame. Sockets stay
   *  registered so the terminate pass can reach the ones that do not answer. */
  closeAllClients(): void {
    for (const connection of this.#connections) {
      connection.goAway();
    }
  }

  /** Shutdown step two: destroy the transports that ignored their close frame. */
  terminateAllClients(): void {
    for (const connection of this.#connections) {
      connection.terminate();
    }
  }
}
