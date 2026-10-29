// The account's socket as the suites dial it: every socket a dial made, which a suite opens,
// writes frames into or drops by hand, and the pings the engine sent on each.

import type { ReplicaSocket, SocketDial } from "../replica-ports";

// what any of a socket's events carries
interface SocketEvent {
  readonly data?: unknown;
  readonly code?: number | undefined;
}

interface FakeSocket extends ReplicaSocket {
  readonly url: string;
  readonly sent: string[];
  closed: boolean;
  readonly open: () => void;
  readonly message: (data: string) => void;
  // the connection goes without the engine closing it
  readonly drop: () => void;
}

export interface FakeSockets {
  readonly dial: SocketDial;
  // every socket dialled, oldest first
  readonly sockets: FakeSocket[];
}

export const fakeSockets = (): FakeSockets => {
  const sockets: FakeSocket[] = [];
  const dial = (url: string): ReplicaSocket => {
    const listeners = new Map<string, ((event: SocketEvent) => void)[]>();
    const on = (type: string, listener: (event: SocketEvent) => void): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };
    const fire = (type: string, event: SocketEvent = {}): void => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    };
    const socket: FakeSocket = {
      addEventListener: on,
      close: () => {
        socket.closed = true;
        fire("close");
      },
      closed: false,
      drop: () => {
        fire("close");
      },
      message: (data) => {
        fire("message", { data });
      },
      open: () => {
        fire("open");
      },
      send: (data) => {
        socket.sent.push(data);
      },
      sent: [],
      url,
    };
    sockets.push(socket);
    return socket;
  };
  return { dial, sockets };
};
