// a dictation socket is hijacked off the http server on upgrade, so server.close() never
// completes while one is open and closeAllConnections() does not touch it. closeAllClients only
// sends the going-away frame and keeps the connection registered: a synchronous forget there
// empties the set before terminateAllClients can reach a stuck socket.

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

export interface VoiceStreamSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  readonly raw?: unknown;
}

export type VoiceStreamFrame = string | Blob | ArrayBufferLike;

// one live mic plus headroom for a stale session still tearing down; each session is ~106 MB.
export const MAX_CONCURRENT_STREAM_SESSIONS = 3;

// @hono/node-ws runs no ping/pong, so the audio is the heartbeat: a live hold sends a frame every
// ~128 ms, and silence this long is a half-open socket whose onClose never comes.
export const STREAM_IDLE_TIMEOUT_MS = 10_000;

const SOCKET_OPEN_STATE = 1;
const NORMAL_CLOSE_CODE = 1000;
// rfc 6455 going away, so the page can tell a deliberate stop from a dropped connection.
const GOING_AWAY_CLOSE_CODE = 1001;
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
    // a dispose that raced the bind still tears the session down.
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
    this.#idleTimer.unref?.();
  }

  #clearIdle(): void {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }

  #reapIdle(): void {
    // the peer stopped sending without closing; its onClose may never come.
    this.terminate();
    void this.dispose();
  }

  send(message: VoiceStreamDownMessage): void {
    if (this.#socket.readyState === SOCKET_OPEN_STATE) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  refuse(message: string): void {
    this.send({ type: "error", message });
    this.#close(POLICY_CLOSE_CODE);
  }

  receive(frame: VoiceStreamFrame): void {
    // every frame is a heartbeat.
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
    if (
      frame.byteLength === 0 ||
      frame.byteLength % 2 !== 0 ||
      frame.byteLength > VOICE_STREAM_FRAME_MAX_BYTES
    ) {
      return;
    }
    // node-ws slices binary frames, so the buffer arrives owned and can be transferred.
    this.#session?.pushPcm(frame);
  }

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

  // does not forget this connection: the terminate pass must still reach a socket that ignores
  // the frame.
  goAway(): void {
    this.#close(GOING_AWAY_CLOSE_CODE, "server-shutting-down");
    const session = this.#session;
    this.#session = null;
    void session?.dispose();
  }

  terminate(): void {
    terminateTransport(this.#socket);
  }

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

export class VoiceStreamHub implements UpgradedSockets {
  readonly #voice: VoiceService;
  readonly #connections = new Set<VoiceStreamConnection>();

  constructor(voice: VoiceService) {
    this.#voice = voice;
  }

  get size(): number {
    return this.#connections.size;
  }

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

  closeAllClients(): void {
    for (const connection of this.#connections) {
      connection.goAway();
    }
  }

  terminateAllClients(): void {
    for (const connection of this.#connections) {
      connection.terminate();
    }
  }
}
