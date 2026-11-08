// The account's socket, a hint and never the state: a frame says what in the library moved, so a
// client refetches what it shows of it, and so does every time the socket opens, since a deploy or
// a drop may have hidden a write meanwhile. It opens with a short-lived ticket an authenticated
// call mints, as a browser's socket carries no header, keeps itself alive with the cell's
// auto-answered ping, and dials again on a doubling wait while it is wanted. The host hands it the
// platform's socket and timers.

import { z } from "zod";

import {
  librarySocketFrameSchema,
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
  SOCKET_TICKET_PARAM,
  V1_SOCKET_PATH,
} from "./library-socket";
import type { LibrarySocketFrame } from "./library-socket";

export interface Clock {
  readonly now: () => number;
  // runs `run` once, `ms` from now; the answer cancels it
  readonly after: (ms: number, run: () => void) => () => void;
}

// the account's socket, as every platform's WebSocket is
export interface AccountSocket {
  readonly addEventListener: {
    (type: "open" | "close", listener: () => void): void;
    (type: "message", listener: (event: { readonly data?: unknown }) => void): void;
  };
  readonly send: (data: string) => void;
  readonly close: () => void;
}

export type SocketDial = (url: string) => AccountSocket;

// answered by the cell's auto-response table without waking it
const KEEPALIVE_MS = 45_000;
// a half-open connection neither answers nor closes, so silence is the only sign of one; two
// intervals, so a tick that runs late behind a busy loop drops no live socket
const SILENCE_MS = 2 * KEEPALIVE_MS;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;

export interface SocketHintArgs {
  readonly dial: SocketDial;
  readonly clock: Clock;
  readonly origin: string;
  // a ticket the account mints for its socket; null when none came (no answer, or a refusal the
  // client's next call hears for itself)
  readonly ticket: () => Promise<string | null>;
  readonly onOpen: () => void;
  readonly onFrame: (frame: LibrarySocketFrame) => void;
}

export interface SocketHint {
  // dials while wanted; a second call while one is open or on its way does nothing
  readonly connect: () => void;
  // for good, until the next connect
  readonly close: () => void;
}

const frameJsonSchema = z.string().transform((text, context) => {
  try {
    return librarySocketFrameSchema.parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not a frame this build reads" });
    return z.NEVER;
  }
});

// the socket's address on the cloud's origin, its scheme the origin's own made a socket's
/** @internal */
export const socketUrl = (origin: string, ticket: string): string => {
  const scheme = origin.startsWith("https:") ? "wss:" : "ws:";
  const rest = origin.replace(/^https?:/u, "");
  return `${scheme}${rest}${V1_SOCKET_PATH}?${SOCKET_TICKET_PARAM}=${encodeURIComponent(ticket)}`;
};

export const createSocketHint = (args: SocketHintArgs): SocketHint => {
  const { clock } = args;
  let wanted = false;
  // every dial and every timer belongs to one generation; a close moves it on, so nothing a
  // closed socket started acts after it
  let generation = 0;
  let socket: AccountSocket | null = null;
  let dialling = false;
  let attempt = 0;
  let cancelReconnect: (() => void) | null = null;
  let cancelKeepalive: (() => void) | null = null;
  let heardAt = 0;

  const stopKeepalive = (): void => {
    cancelKeepalive?.();
    cancelKeepalive = null;
  };

  const keepAlive = (owner: number, live: AccountSocket): void => {
    cancelKeepalive = clock.after(KEEPALIVE_MS, () => {
      if (owner !== generation || socket !== live) {
        return;
      }
      if (clock.now() - heardAt > SILENCE_MS) {
        live.close();
        return;
      }
      live.send(SOCKET_KEEPALIVE_PING);
      keepAlive(owner, live);
    });
  };

  const scheduleReconnect = (owner: number, redial: () => void): void => {
    if (!wanted || owner !== generation || cancelReconnect !== null) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    attempt += 1;
    cancelReconnect = clock.after(delay, () => {
      cancelReconnect = null;
      if (owner === generation) {
        redial();
      }
    });
  };

  const listen = (owner: number, live: AccountSocket, redial: () => void): void => {
    live.addEventListener("open", () => {
      if (owner !== generation) {
        return;
      }
      attempt = 0;
      heardAt = clock.now();
      keepAlive(owner, live);
      args.onOpen();
    });
    live.addEventListener("message", (event) => {
      if (owner !== generation) {
        return;
      }
      heardAt = clock.now();
      if (event.data === SOCKET_KEEPALIVE_PONG) {
        return;
      }
      const frame = frameJsonSchema.safeParse(event.data);
      if (frame.success) {
        args.onFrame(frame.data);
      }
    });
    live.addEventListener("close", () => {
      if (owner !== generation || socket !== live) {
        return;
      }
      socket = null;
      stopKeepalive();
      scheduleReconnect(owner, redial);
    });
  };

  const dial = async (owner: number): Promise<void> => {
    if (!wanted || owner !== generation || socket !== null || dialling) {
      return;
    }
    const redial = (): void => {
      void dial(owner);
    };
    dialling = true;
    const ticket = await args.ticket();
    if (owner !== generation || !wanted) {
      return;
    }
    dialling = false;
    if (ticket === null) {
      scheduleReconnect(owner, redial);
      return;
    }
    const live = args.dial(socketUrl(args.origin, ticket));
    socket = live;
    listen(owner, live, redial);
  };

  return {
    close: () => {
      wanted = false;
      generation += 1;
      cancelReconnect?.();
      cancelReconnect = null;
      stopKeepalive();
      const live = socket;
      socket = null;
      dialling = false;
      live?.close();
    },
    connect: () => {
      wanted = true;
      attempt = 0;
      void dial(generation);
    },
  };
};
