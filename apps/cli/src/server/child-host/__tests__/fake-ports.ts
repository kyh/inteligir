// an in-memory MessageChannel with MessagePortMain's semantics: frames are structured clones, held
// until the receiving end starts, and closing one end tells the other.

import type { ForkRequest } from "../fork-broker-wire";
import type { MessagePortLike, ParentPortLike, PortFrame, PortMessageEvent } from "../message-port";

type MessageListener = (message: PortMessageEvent) => void;

// a close listener takes no argument, so the one it is handed goes unread
const CLOSED: PortMessageEvent = { data: null, ports: [] };

class FakePort implements MessagePortLike {
  peer: FakePort | null = null;
  closed = false;
  #started = false;
  #held: PortMessageEvent[] = [];
  readonly #messageListeners: MessageListener[] = [];
  readonly #closeListeners: MessageListener[] = [];

  postMessage(message: PortFrame): void {
    if (this.closed) {
      throw new Error("posted to a closed port");
    }
    this.peer?.receive({ data: structuredClone(message), ports: [] });
  }

  on(event: "message", listener: MessageListener): void;
  on(event: "close", listener: () => void): void;
  on(event: "message" | "close", listener: MessageListener): void {
    (event === "message" ? this.#messageListeners : this.#closeListeners).push(listener);
  }

  start(): void {
    this.#started = true;
    for (const message of this.#held.splice(0)) {
      this.#dispatch(message);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.peer?.hangUp();
  }

  receive(message: PortMessageEvent): void {
    if (this.#started) {
      this.#dispatch(message);
    } else {
      this.#held.push(message);
    }
  }

  hangUp(): void {
    this.closed = true;
    for (const listener of this.#closeListeners) {
      listener(CLOSED);
    }
  }

  #dispatch(message: PortMessageEvent): void {
    for (const listener of this.#messageListeners) {
      listener(message);
    }
  }
}

export const fakeChannel = () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  port1.peer = port2;
  port2.peer = port1;
  return { port1, port2 };
};

// the server's `process.parentPort`: what it posts to main is kept, and main's frames are emitted.
export interface FakeParentPort extends ParentPortLike {
  posted: ForkRequest[];
  emit: (data: PortMessageEvent["data"], ports?: readonly MessagePortLike[]) => void;
}

export const fakeParentPort = (): FakeParentPort => {
  const posted: ForkRequest[] = [];
  let listener: MessageListener | null = null;
  return {
    emit: (data, ports = []) => {
      listener?.({ data, ports });
    },
    on: (_event, next) => {
      listener = next;
    },
    postMessage: (message) => {
      posted.push(structuredClone(message));
    },
    posted,
  };
};
