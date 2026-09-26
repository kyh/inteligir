// the frame parse and the keepalive are one spelling for both clients. the dial is the one platform
// part: node's WebSocket takes the bearer as `{ headers }` and React Native's as a third argument,
// and neither is the DOM's, which takes no headers at all.

import { z } from "zod";
import type { CloudSocket, CloudSocketOpener } from "../cloud-client";
import {
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_PATH,
  SYNC_WS_PHONE_REQUESTS_ON,
  SYNC_WS_PHONE_REQUESTS_PARAM,
  SYNC_WS_PLATFORM_PARAM,
  syncPingSchema,
} from "./sync-ws";

// answered by the worker's auto-response table without waking the hibernated object.
const KEEPALIVE_INTERVAL_MS = 45_000;
// a half-open connection neither answers nor closes, so silence is the only sign of one. two
// intervals, not one: a tick that runs late behind a busy loop must not drop a live socket.
const KEEPALIVE_DEADLINE_MS = 2 * KEEPALIVE_INTERVAL_MS;
// rfc 6455's "closed abnormally", reported to the link and never sent: the peer is not answering.
const UNANSWERED_CLOSE_CODE = 1006;

// the members of a platform WebSocket the opener uses, which node's and React Native's both have;
// the package compiles with no DOM, so it names no WebSocket of its own. its timers are cleared by
// close(), which every runtime's teardown calls, so none of them holds a node process open.
export interface DialledSocket {
  addEventListener: {
    (type: "open" | "error", listener: () => void): void;
    (type: "message", listener: (event: { data?: unknown }) => void): void;
    (type: "close", listener: (event: { code?: number | undefined }) => void): void;
  };
  send: (data: string) => void;
  close: () => void;
}

export type SocketDial = (url: string, headers: Record<string, string>) => DialledSocket;

export const createCloudSocketOpener =
  (dial: SocketDial): CloudSocketOpener =>
  (args): CloudSocket => {
    const url = new URL(SYNC_WS_PATH, args.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(SYNC_WS_PLATFORM_PARAM, args.listener.platform);
    if (args.listener.platform === "desktop" && args.listener.phoneRequests) {
      url.searchParams.set(SYNC_WS_PHONE_REQUESTS_PARAM, SYNC_WS_PHONE_REQUESTS_ON);
    }

    const socket = dial(url.toString(), { authorization: `Bearer ${args.credential}` });
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let finished = false;
    let lastFrameAt = 0;

    const stopKeepalive = (): void => {
      if (keepalive !== null) {
        clearInterval(keepalive);
        keepalive = null;
      }
    };

    const finish = (code: number): void => {
      if (finished) {
        return;
      }
      finished = true;
      stopKeepalive();
      args.onClose(code);
    };

    socket.addEventListener("open", () => {
      lastFrameAt = Date.now();
      keepalive = setInterval(() => {
        if (Date.now() - lastFrameAt > KEEPALIVE_DEADLINE_MS) {
          // reported here, not left to the close event: a closing handshake nobody answers takes
          // as long to give up as the silence it is reporting.
          finish(UNANSWERED_CLOSE_CODE);
          socket.close();
          return;
        }
        try {
          socket.send(SYNC_WS_KEEPALIVE_PING);
        } catch {
          // Closing between the tick and the send; the close event follows.
        }
      }, KEEPALIVE_INTERVAL_MS);
      args.onOpen();
    });

    socket.addEventListener("message", (event) => {
      lastFrameAt = Date.now();
      const frame = z.string().safeParse(event.data);
      if (!frame.success) {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(frame.data);
      } catch {
        // The keepalive pong is a bare word, not a frame.
        return;
      }
      const parsed = syncPingSchema.safeParse(raw);
      if (parsed.success) {
        args.onPing(parsed.data);
      }
    });

    socket.addEventListener("close", (event) => {
      finish(event.code ?? UNANSWERED_CLOSE_CODE);
    });
    socket.addEventListener("error", () => {
      // a failure before open produces no close event on some paths; the runtime needs one terminal callback.
      finish(0);
    });

    return {
      close() {
        // set first: a deliberate close must not arm the runtime's reconnect.
        finished = true;
        stopKeepalive();
        socket.close();
      },
    };
  };
