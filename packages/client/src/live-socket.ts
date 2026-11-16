// A socket this device keeps open to the cloud while it is wanted and the host reaches the cloud.
// partysocket dials, on an address carrying a short-lived ticket an authenticated call mints for
// each try, as a browser's socket carries no header, and dials again on a growing wait; this holds
// it closed while it is unwanted or the host cannot reach the cloud, and pings it on a beat, taking
// one whose answer is late for dead, since a half-open connection neither answers nor closes.

import ReconnectingWebSocket from "partysocket/ws";
import { z } from "zod";

// the platform's WebSocket, or a suite's
export type WebSocketClass = new (url: string) => EventTarget;

// whether the host can reach the cloud, and a listener told each time that changes: the network
// alone in a tab, the app in front too on a phone
export interface Reach {
  readonly get: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

// the ping the cloud answers without waking, its answer, how often it goes and how long the answer
// may take
interface Keepalive {
  readonly ping: string;
  readonly pong: string;
  readonly everyMs: number;
  readonly answerMs: number;
}

// a frame as it arrives: text, or binary bytes
export type Frame =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array<ArrayBuffer> };

const textFrame = (text: string): Frame => ({ kind: "text", text });
const bytesFrame = (buffer: ArrayBuffer): Frame => ({
  bytes: new Uint8Array(buffer),
  kind: "bytes",
});

// the binary type the socket asks for hands bytes over as an ArrayBuffer
const frameSchema = z.union([
  z.string().transform(textFrame),
  z.instanceof(ArrayBuffer).transform(bytesFrame),
]);

// the wait before a dial after a drop, each next one `grow` times the last, up to `mostMs`
interface Backoff {
  readonly firstMs: number;
  readonly grow: number;
  readonly mostMs: number;
}

export interface LiveSocketArgs {
  // the socket's address with a fresh ticket in it, asked on every dial; a rejection is no address
  // this try, which waits and goes again
  readonly address: () => Promise<string>;
  readonly reach: Reach;
  readonly keepalive: Keepalive;
  readonly backoff: Backoff;
  // a close under one of these codes says what the socket reaches is not there: it dials no more
  // until the next connect
  readonly endsOn?: readonly number[];
  readonly onUp: () => void;
  // the open socket closed, or one closed under a code it ends on
  readonly onDown: (code: number) => void;
  // every frame but the keepalive's answer
  readonly onMessage: (frame: Frame) => void;
  readonly WebSocket?: WebSocketClass;
}

export interface LiveSocket {
  // wanted from now: it dials whenever the host reaches the cloud, and lets go whenever it cannot
  readonly connect: () => void;
  // for good, until the next connect
  readonly close: () => void;
  // on the open socket, and dropped while none is, since each socket starts afresh
  readonly send: (data: string | Uint8Array<ArrayBuffer>) => void;
  // an open socket is pinged now, as one may not have outlived a sleep
  readonly probe: () => void;
}

export const createLiveSocket = (args: LiveSocketArgs): LiveSocket => {
  const { keepalive } = args;
  const ends = (code: number): boolean => args.endsOn?.includes(code) ?? false;
  // wanted while it is subscribed to the reach
  let unsubscribe: (() => void) | null = null;
  const wanted = (): boolean => unsubscribe !== null && args.reach.get();

  const socket = new ReconnectingWebSocket(
    async () => {
      // partysocket's close lets a dial already waiting out its backoff ask for its address
      if (!wanted()) {
        throw new Error("the socket is not wanted now");
      }
      return await args.address();
    },
    undefined,
    {
      maxEnqueuedMessages: 0,
      maxReconnectionDelay: args.backoff.mostMs,
      minReconnectionDelay: args.backoff.firstMs,
      reconnectionDelayGrowFactor: args.backoff.grow,
      shouldReconnectOnClose: ({ code }) => !ends(code),
      startClosed: true,
      WebSocket: args.WebSocket,
    },
  );
  socket.binaryType = "arraybuffer";
  let up = false;
  let beat: ReturnType<typeof setInterval> | undefined;
  let answerDue: ReturnType<typeof setTimeout> | undefined;

  const heard = (): void => {
    clearTimeout(answerDue);
    answerDue = undefined;
  };
  const ping = (): void => {
    socket.send(keepalive.ping);
    answerDue ??= setTimeout(() => {
      answerDue = undefined;
      socket.reconnect();
    }, keepalive.answerMs);
  };

  socket.addEventListener("open", () => {
    up = true;
    clearInterval(beat);
    beat = setInterval(ping, keepalive.everyMs);
    args.onUp();
  });
  socket.addEventListener("close", ({ code }) => {
    clearInterval(beat);
    heard();
    if (ends(code)) {
      unsubscribe?.();
      unsubscribe = null;
    }
    if (up || ends(code)) {
      up = false;
      args.onDown(code);
    }
  });
  socket.addEventListener("message", (event) => {
    heard();
    const frame = frameSchema.safeParse(event.data);
    if (frame.success && !(frame.data.kind === "text" && frame.data.text === keepalive.pong)) {
      args.onMessage(frame.data);
    }
  });

  const judge = (): void => {
    if (!wanted()) {
      socket.close();
    } else if (!socket.shouldReconnect) {
      socket.reconnect();
    }
  };
  return {
    close: () => {
      unsubscribe?.();
      unsubscribe = null;
      judge();
    },
    connect: () => {
      unsubscribe ??= args.reach.subscribe(judge);
      judge();
    },
    probe: () => {
      if (up) {
        ping();
      }
    },
    send: (data) => {
      socket.send(data);
    },
  };
};
