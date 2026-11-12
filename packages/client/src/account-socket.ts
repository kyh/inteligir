// The account's socket, a hint and never the state: a frame says what in the library moved, so a
// client reads again what it shows of it, and so does every time the socket comes up, since a
// deploy or a drop may have hidden a write meanwhile. partysocket dials, on a short-lived ticket an
// authenticated call mints for each try, as a browser's socket carries no header, and dials again
// on a doubling wait; this keeps it alive with the cell's auto-answered ping, drops one gone
// silent, reads its frames, and holds it closed while it is unwanted or the host is offline.

import ReconnectingWebSocket from "partysocket/ws";
import { z } from "zod";

import {
  librarySocketFrameSchema,
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
  socketUrl,
} from "@repo/contract/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";

// up: anything may have moved while no socket said so; down: nothing the socket said holds any
// more, and the reply being written stops arriving
type SocketStatus = "up" | "down";

// the platform's WebSocket, or a suite's
export type WebSocketClass = new (url: string) => EventTarget;

// answered by the cell's auto-response table without waking it
const KEEPALIVE_MS = 45_000;
// a half-open connection neither answers nor closes, so silence is the only sign of one; two
// intervals, so a tick that runs late behind a busy loop drops no live socket
const SILENCE_MS = 2 * KEEPALIVE_MS;

export interface AccountSocketArgs {
  readonly origin: string;
  // a ticket the account mints for its socket; a rejection is no ticket this try, which waits and
  // goes again (no answer, or a refusal the client's next call hears for itself)
  readonly ticket: () => Promise<string>;
  readonly onStatus: (status: SocketStatus) => void;
  readonly onFrame: (frame: LibrarySocketFrame) => void;
  readonly WebSocket?: WebSocketClass;
}

export interface AccountSocket {
  // wanted from now: it dials unless the host said it is offline
  readonly connect: () => void;
  // for good, until the next connect
  readonly close: () => void;
  // the host's network: offline lets the socket go and dials nothing; online dials while wanted
  readonly online: () => void;
  readonly offline: () => void;
}

const frameJsonSchema = z.string().transform((text, context) => {
  try {
    return librarySocketFrameSchema.parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not a frame this build reads" });
    return z.NEVER;
  }
});

export const createAccountSocket = (args: AccountSocketArgs): AccountSocket => {
  const socket = new ReconnectingWebSocket(
    async () => socketUrl(args.origin, await args.ticket()),
    undefined,
    {
      // a ping queued while closed would go out on the next socket, to no purpose
      maxEnqueuedMessages: 0,
      maxReconnectionDelay: 60_000,
      minReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 2,
      startClosed: true,
      WebSocket: args.WebSocket,
    },
  );
  let wanted = false;
  let reachable = true;
  let up = false;
  let heardAt = 0;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  socket.addEventListener("open", () => {
    up = true;
    heardAt = Date.now();
    clearInterval(keepalive);
    keepalive = setInterval(() => {
      if (Date.now() - heardAt > SILENCE_MS) {
        socket.reconnect();
      } else {
        socket.send(SOCKET_KEEPALIVE_PING);
      }
    }, KEEPALIVE_MS);
    args.onStatus("up");
  });
  socket.addEventListener("close", () => {
    clearInterval(keepalive);
    if (up) {
      up = false;
      args.onStatus("down");
    }
  });
  socket.addEventListener("message", (event) => {
    heardAt = Date.now();
    const data: unknown = event.data;
    if (data === SOCKET_KEEPALIVE_PONG) {
      return;
    }
    const frame = frameJsonSchema.safeParse(data);
    if (frame.success) {
      args.onFrame(frame.data);
    }
  });

  const judge = (): void => {
    if (!wanted || !reachable) {
      socket.close();
    } else if (!socket.shouldReconnect) {
      socket.reconnect();
    }
  };
  return {
    close: () => {
      wanted = false;
      judge();
    },
    connect: () => {
      wanted = true;
      judge();
    },
    offline: () => {
      reachable = false;
      judge();
    },
    online: () => {
      reachable = true;
      judge();
    },
  };
};
