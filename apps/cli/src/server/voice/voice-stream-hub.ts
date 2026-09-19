// a dictation socket is hijacked off the http server on upgrade, so server.close() never
// completes while one is open and closeAllConnections() does not touch it. closeAllClients only
// sends the going-away frame and keeps the connection registered: a synchronous forget there
// empties the set before terminateAllClients can reach a stuck socket.

import type { UpgradedSockets } from "../listen";
import { VoiceStreamConnection } from "./voice-stream-connection";
import type { VoiceStreamSocket } from "./voice-stream-connection";
import type { VoiceService } from "./voice-service";

// one live mic plus headroom for a stale session still tearing down; each session is ~106 MB.
export const MAX_CONCURRENT_STREAM_SESSIONS = 3;

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
    const connection = new VoiceStreamConnection(socket, (c) => {
      this.#connections.delete(c);
    });
    if (this.#connections.size >= MAX_CONCURRENT_STREAM_SESSIONS) {
      connection.refuse("Too many dictation sessions are open. Stop another and try again.");
      return connection;
    }
    this.#connections.add(connection);
    const session = this.#voice.createStreamSession({
      onError: (message) => {
        connection.send({ message, type: "error" });
        connection.close();
      },
      onFinal: (text) => {
        connection.send({ text, type: "final" });
        connection.close();
      },
      onPartial: (text) => {
        connection.send({ text, type: "partial" });
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
