// `WebSocket` stub for DOM suites that drive the bus: it opens at once and hears nothing until
// the test delivers a frame, since a booted server's own broadcasts never reach jsdom.

import type { ServerMessage } from "@repo/api/local/notifications";

type Listener = (event: { data?: unknown }) => void;

export class ScriptedSocket {
  static readonly live = new Set<ScriptedSocket>();

  // every socket the page holds hears it, as every tab on the bus would
  static deliverToAll(frame: ServerMessage): void {
    for (const socket of ScriptedSocket.live) {
      socket.deliver(frame);
    }
  }

  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    ScriptedSocket.live.add(this);
    queueMicrotask(() => {
      this.fire("open", {});
    });
  }

  addEventListener = (type: string, listener: Listener): void => {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  };

  // the page's subscribe frames: the test scripts the answers, so nothing reads them
  // oxlint-disable-next-line class-methods-use-this -- the socket's instance API: `new WebSocket()` reaches it on the instance, never as a static
  send = (): void => {};

  close = (): void => {
    ScriptedSocket.live.delete(this);
  };

  deliver = (frame: ServerMessage): void => {
    this.fire("message", { data: JSON.stringify(frame) });
  };

  private fire(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}
