// The `/voice/stream` connections, and their teardown by name.
//
// A dictation socket is HIJACKED off the HTTP server the moment it upgrades, so
// `server.close()` never completes while one is open and `closeAllConnections()`
// does not touch it — the exact trap `CLAUDE.md`'s shutdown decision records for
// `/ws`. So this hub tracks every open connection and the listener teardown step
// closes them BY NAME, the same drain the invalidation bus gets: a close frame
// first, then the transport destroyed if it did not answer. Each connection also
// disposes its transcription worker, so a live hold leaves no thread behind.
//
// The hub OWNS the binding: `open` mints the session (a real worker, or the
// scripted fake) and wires its partials/final/error onto the socket, so the
// route handler only forwards frames and closes.

import {
  VOICE_STREAM_FRAME_MAX_BYTES,
  voiceStreamUpMessageSchema,
  type VoiceStreamDownMessage,
} from "@repo/server-contract/voice";
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

const SOCKET_OPEN_STATE = 1;
/** RFC 6455 normal closure — a session that finished. */
const NORMAL_CLOSE_CODE = 1000;
/** RFC 6455 "going away" — a server shutting down owes the client this so the
 *  page can tell a deliberate stop from a dropped connection. */
const GOING_AWAY_CLOSE_CODE = 1001;

export class VoiceStreamConnection {
  readonly #socket: VoiceStreamSocket;
  readonly #forget: (connection: VoiceStreamConnection) => void;
  #session: StreamSession | null = null;
  #disposed = false;

  constructor(socket: VoiceStreamSocket, forget: (connection: VoiceStreamConnection) => void) {
    this.#socket = socket;
    this.#forget = forget;
  }

  bind(session: StreamSession): void {
    this.#session = session;
    // A dispose that raced the bind (the socket closed before the session
    // existed) still tears the session down.
    if (this.#disposed) {
      void session.dispose();
      this.#session = null;
    }
  }

  send(message: VoiceStreamDownMessage): void {
    if (this.#socket.readyState === SOCKET_OPEN_STATE) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  /** A frame off the wire: a control message (text) or a PCM16 chunk (binary). */
  receive(frame: VoiceStreamFrame): void {
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
    try {
      this.#socket.close(NORMAL_CLOSE_CODE);
    } catch {
      // Already closing; dispose is the backstop.
    }
  }

  /** Shutdown: tell the client the server is going away. */
  goAway(): void {
    try {
      this.#socket.close(GOING_AWAY_CLOSE_CODE, "server-shutting-down");
    } catch {
      // Already closing; the terminate pass is the backstop.
    }
  }

  /** Destroy a transport that ignored its close frame. */
  terminate(): void {
    terminateTransport(this.#socket);
  }

  /** Tear the worker down and forget this connection. Idempotent — the socket's
   *  onClose, a final, an error and the shutdown all reach it. */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#forget(this);
    const session = this.#session;
    this.#session = null;
    await session?.dispose();
  }
}

/**
 * Tracks the open dictation sockets and implements the teardown seam
 * `closeServer` drains. Folded beside the invalidation bus in the listener step
 * so a live hold cannot stall the process's exit.
 */
export class VoiceStreamHub implements UpgradedSockets {
  readonly #voice: VoiceService;
  readonly #connections = new Set<VoiceStreamConnection>();

  constructor(voice: VoiceService) {
    this.#voice = voice;
  }

  /** Register a freshly upgraded socket and mint its session. */
  open(socket: VoiceStreamSocket): VoiceStreamConnection {
    const connection = new VoiceStreamConnection(socket, (c) => this.#connections.delete(c));
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

  closeAllClients(): void {
    for (const connection of this.#connections) {
      connection.goAway();
      // Terminates the worker deterministically rather than waiting on onClose.
      void connection.dispose();
    }
  }

  terminateAllClients(): void {
    for (const connection of this.#connections) {
      connection.terminate();
    }
  }
}
