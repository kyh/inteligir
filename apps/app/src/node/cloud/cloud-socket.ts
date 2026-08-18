// The real dial for the cloud's invalidation socket.
//
// IMPORTED BY `main.ts` AND NOTHING ELSE, and that has to stay true. A UI test
// harness imports the node test harness, so every module reachable from
// `app.ts` is also compiled by the browser tsconfig — where `WebSocket` is the
// DOM one, whose second argument is a subprotocol list rather than an options
// bag. Node's takes `{ headers }`, which is how `Authorization` rides the
// UPGRADE, which is why the contract needs no ticket machinery at all. So this
// module stays outside that graph and reaches the runtime as an injected
// opener; importing it from `app.ts` breaks the UI typecheck with an error
// that says nothing about any of this.

import {
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_PATH,
  SYNC_WS_PLATFORM_PARAM,
  syncPingSchema,
} from "@repo/cloud-contract/ws";
import type { CloudSocket, CloudSocketOpener } from "./cloud-client";

/** The client keepalive cadence. The server answers it from the runtime's
 *  auto-response table without waking the hibernated object, so this costs a
 *  frame rather than an invocation. */
const KEEPALIVE_INTERVAL_MS = 45_000;

export const openCloudSocket: CloudSocketOpener = (args): CloudSocket => {
  const url = new URL(SYNC_WS_PATH, args.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set(SYNC_WS_PLATFORM_PARAM, args.platform);

  const socket = new WebSocket(url.toString(), {
    headers: { authorization: `Bearer ${args.credential}` },
  });
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let finished = false;

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
    keepalive = setInterval(() => {
      try {
        socket.send(SYNC_WS_KEEPALIVE_PING);
      } catch {
        // Closing between the tick and the send; the close event follows.
      }
    }, KEEPALIVE_INTERVAL_MS);
    // Never the reason this process stays alive: a socket nobody is waiting on
    // must not hold the event loop open through a shutdown.
    keepalive.unref?.();
    args.onOpen();
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(event.data);
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
    // A failure before `open` produces no close event on some paths, and the
    // runtime needs exactly one terminal callback either way.
    finish(0);
  });

  return {
    close() {
      // Set first: a deliberate close is not a disconnect, and must not arm
      // the runtime's reconnect.
      finished = true;
      stopKeepalive();
      socket.close();
    },
  };
};
