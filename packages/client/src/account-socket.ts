// The account's socket, a hint and never the state: a frame says what in the library moved, so a
// client reads again what it shows of it, and so does every time the socket comes up, since a
// deploy or a drop may have hidden a write meanwhile. A live socket (`./live-socket`) keeps it open
// on the cell's auto-answered ping; this reads its frames.

import { z } from "zod";

import {
  librarySocketFrameSchema,
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
  socketUrl,
  V1_SOCKET_PATH,
} from "@repo/contract/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";

import { createLiveSocket } from "./live-socket";
import type { LiveSocket, Reach, WebSocketClass } from "./live-socket";

// up: anything may have moved while no socket said so; down: nothing the socket said holds any
// more, and the reply being written stops arriving
type SocketStatus = "up" | "down";

// answered by the cell's auto-response table without waking it; a ping goes unanswered for a whole
// beat before the socket is taken for dead, so a tick that runs late behind a busy loop drops no
// live socket
const KEEPALIVE_MS = 45_000;

export interface AccountSocketArgs {
  readonly origin: string;
  readonly reach: Reach;
  // a ticket the account mints for its socket; a rejection is no ticket this try, which waits and
  // goes again (no answer, or a refusal the client's next call hears for itself)
  readonly ticket: () => Promise<string>;
  readonly onStatus: (status: SocketStatus) => void;
  readonly onFrame: (frame: LibrarySocketFrame) => void;
  readonly WebSocket?: WebSocketClass;
}

export type AccountSocket = Pick<LiveSocket, "connect" | "close">;

const frameJsonSchema = z.string().transform((text, context) => {
  try {
    return librarySocketFrameSchema.parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not a frame this build reads" });
    return z.NEVER;
  }
});

export const createAccountSocket = (args: AccountSocketArgs): AccountSocket =>
  createLiveSocket({
    address: async () => socketUrl(args.origin, V1_SOCKET_PATH, await args.ticket()),
    backoff: { firstMs: 1000, grow: 2, mostMs: 60_000 },
    keepalive: {
      answerMs: KEEPALIVE_MS,
      everyMs: KEEPALIVE_MS,
      ping: SOCKET_KEEPALIVE_PING,
      pong: SOCKET_KEEPALIVE_PONG,
    },
    onDown: () => {
      args.onStatus("down");
    },
    onMessage: (message) => {
      const frame = frameJsonSchema.safeParse(message.kind === "text" ? message.text : null);
      if (frame.success) {
        args.onFrame(frame.data);
      }
    },
    onUp: () => {
      args.onStatus("up");
    },
    reach: args.reach,
    WebSocket: args.WebSocket,
  });
