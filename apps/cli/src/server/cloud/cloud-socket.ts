// imported by serve.ts only: app.ts is also compiled under the browser tsconfig,
// where WebSocket's second argument is a protocol list, not node's `{ headers }`.

import {
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_PATH,
  SYNC_WS_PLATFORM_PARAM,
  syncPingSchema,
} from "@repo/api/cloud/sync/sync-ws";
import type { CloudSocket, CloudSocketOpener } from "@repo/api/cloud/client";
import { z } from "zod";

// answered by the worker's auto-response table without waking the hibernated object.
const KEEPALIVE_INTERVAL_MS = 45_000;
// a half-open connection neither answers nor closes, so silence is the only sign of one. two
// intervals, not one: a tick that runs late behind a busy loop must not drop a live socket.
const KEEPALIVE_DEADLINE_MS = 2 * KEEPALIVE_INTERVAL_MS;
// rfc 6455's "closed abnormally", reported to the link and never sent: the peer is not answering.
const UNANSWERED_CLOSE_CODE = 1006;

export const openCloudSocket: CloudSocketOpener = (args): CloudSocket => {
  const url = new URL(SYNC_WS_PATH, args.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set(SYNC_WS_PLATFORM_PARAM, args.platform);

  const socket = new WebSocket(url.toString(), {
    headers: { authorization: `Bearer ${args.credential}` },
  });
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
    // must not hold the event loop open through a shutdown.
    keepalive.unref?.();
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
    finish(event.code);
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
