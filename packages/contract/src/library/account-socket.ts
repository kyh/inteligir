// The account's socket, a hint and never the state: a frame says what in the library moved, so a
// client refetches what it shows of it, and so does every time the socket comes up, since a deploy
// or a drop may have hidden a write meanwhile. It opens with a short-lived ticket an authenticated
// call mints, as a browser's socket carries no header, keeps itself alive with the cell's
// auto-answered ping, and dials again on a doubling wait while it is wanted and the host says it is
// online. Where it stands is one value, moved by one step (`hintAfter`); the host hands it the
// platform's socket and timers, and hears it go up and down.

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

// up: anything may have moved while no socket said so; down: nothing the socket said holds any
// more, and the reply being written stops arriving
/** @internal */
export type SocketStatus = "up" | "down";

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
  // a ticket the account mints for its socket; a rejection is no ticket this time (no answer, or a
  // refusal the client's next call hears for itself)
  readonly ticket: () => Promise<string>;
  readonly onStatus: (status: SocketStatus) => void;
  readonly onFrame: (frame: LibrarySocketFrame) => void;
}

export interface SocketHint {
  // wanted from now: it dials unless the host said it is offline; a second call while one is open
  // or on its way does nothing, and one while a redial waits dials at once
  readonly connect: () => void;
  // for good, until the next connect
  readonly close: () => void;
  // the host's network: offline lets the socket go and dials nothing; online dials at once while
  // the socket is wanted
  readonly online: () => void;
  readonly offline: () => void;
}

// one try at a socket, which is its own token: a ticket answered to an earlier try, or anything an
// earlier try's socket says, acts on nothing. `attempt`: the tries that failed in a row before it
interface Ticketing {
  readonly kind: "ticketing";
  readonly attempt: number;
}

type Hint =
  // not wanted; `online` is the host's last word, which the next connect meets
  | { readonly kind: "idle"; readonly online: boolean }
  // wanted, while the host says there is no network
  | { readonly kind: "offline" }
  | Ticketing
  | { readonly kind: "connecting"; readonly attempt: number; readonly socket: AccountSocket }
  | { readonly kind: "open"; readonly socket: AccountSocket; readonly heardAt: number }
  // `attempt` tries failed in a row; the next goes once its wait is up
  | { readonly kind: "waiting"; readonly attempt: number };

// the host's word, or the redial's wait being up
interface WantEvent {
  readonly kind: "connect" | "close" | "online" | "offline" | "retry";
}

// a try's ticket answered, and the socket it dialled
type TryEvent =
  | { readonly kind: "ticketed"; readonly asked: Ticketing; readonly ticket: string | null }
  | { readonly kind: "dialled"; readonly asked: Ticketing; readonly socket: AccountSocket };

// what a socket did, or its keepalive being due
type SocketEvent =
  | { readonly kind: "opened" | "closed" | "keepalive"; readonly socket: AccountSocket }
  | { readonly kind: "heard"; readonly socket: AccountSocket; readonly data: unknown };

type HintEvent = WantEvent | TryEvent | SocketEvent;

type HintEffect =
  | { readonly kind: "ticket"; readonly asked: Ticketing }
  | { readonly kind: "dial"; readonly asked: Ticketing; readonly ticket: string }
  // the one timer, replacing any other
  | { readonly kind: "after"; readonly ms: number; readonly event: HintEvent }
  | { readonly kind: "ping" | "shut"; readonly socket: AccountSocket }
  | { readonly kind: "status"; readonly status: SocketStatus }
  | { readonly kind: "frame"; readonly frame: LibrarySocketFrame };

interface HintStep {
  readonly hint: Hint;
  readonly effects: readonly HintEffect[];
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

const stay = (hint: Hint): HintStep => ({ effects: [], hint });

const tryAfter = (attempt: number): HintStep => {
  const asked: Ticketing = { attempt, kind: "ticketing" };
  return { effects: [{ asked, kind: "ticket" }], hint: asked };
};

const waitAfter = (failed: number, before: readonly HintEffect[] = []): HintStep => ({
  effects: [
    ...before,
    {
      event: { kind: "retry" },
      kind: "after",
      ms: Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** failed),
    },
  ],
  hint: { attempt: failed + 1, kind: "waiting" },
});

// the socket the hint holds, shut, and the host told it is down when it was up; a socket shut here
// closes late or never, and its close then acts on nothing
const letGo = (hint: Hint): readonly HintEffect[] => {
  switch (hint.kind) {
    case "connecting": {
      return [{ kind: "shut", socket: hint.socket }];
    }
    case "open": {
      return [
        { kind: "shut", socket: hint.socket },
        { kind: "status", status: "down" },
      ];
    }
    default: {
      return [];
    }
  }
};

const wantAfter = (hint: Hint, event: WantEvent): HintStep => {
  switch (event.kind) {
    case "connect": {
      if (hint.kind === "idle") {
        return hint.online ? tryAfter(0) : stay({ kind: "offline" });
      }
      return hint.kind === "waiting" ? tryAfter(0) : stay(hint);
    }
    case "online": {
      if (hint.kind === "idle") {
        return stay({ kind: "idle", online: true });
      }
      return hint.kind === "offline" || hint.kind === "waiting" ? tryAfter(0) : stay(hint);
    }
    case "offline": {
      return hint.kind === "idle"
        ? stay({ kind: "idle", online: false })
        : { effects: letGo(hint), hint: { kind: "offline" } };
    }
    case "close": {
      const online = hint.kind === "idle" ? hint.online : hint.kind !== "offline";
      return { effects: letGo(hint), hint: { kind: "idle", online } };
    }
    case "retry": {
      return hint.kind === "waiting" ? tryAfter(hint.attempt) : stay(hint);
    }
    // no default
  }
};

const tryEventAfter = (hint: Hint, event: TryEvent): HintStep => {
  const { asked } = event;
  if (event.kind === "dialled") {
    return hint === asked
      ? stay({ attempt: asked.attempt, kind: "connecting", socket: event.socket })
      : { effects: [{ kind: "shut", socket: event.socket }], hint };
  }
  if (hint !== asked) {
    return stay(hint);
  }
  return event.ticket === null
    ? waitAfter(asked.attempt)
    : { effects: [{ asked, kind: "dial", ticket: event.ticket }], hint };
};

const keepAliveAfter = (socket: AccountSocket): HintEffect => ({
  event: { kind: "keepalive", socket },
  kind: "after",
  ms: KEEPALIVE_MS,
});

const socketEventAfter = (hint: Hint, event: SocketEvent, now: number): HintStep => {
  const { socket } = event;
  if (event.kind === "opened") {
    return hint.kind === "connecting" && hint.socket === socket
      ? {
          effects: [{ kind: "status", status: "up" }, keepAliveAfter(socket)],
          hint: { heardAt: now, kind: "open", socket },
        }
      : stay(hint);
  }
  if (event.kind === "closed") {
    if (hint.kind === "connecting" && hint.socket === socket) {
      return waitAfter(hint.attempt);
    }
    return hint.kind === "open" && hint.socket === socket
      ? waitAfter(0, [{ kind: "status", status: "down" }])
      : stay(hint);
  }
  if (hint.kind !== "open" || hint.socket !== socket) {
    return stay(hint);
  }
  if (event.kind === "heard") {
    const frame =
      event.data === SOCKET_KEEPALIVE_PONG ? null : frameJsonSchema.safeParse(event.data);
    return {
      effects: frame?.success === true ? [{ frame: frame.data, kind: "frame" }] : [],
      hint: { ...hint, heardAt: now },
    };
  }
  return now - hint.heardAt > SILENCE_MS
    ? waitAfter(0, letGo(hint))
    : { effects: [{ kind: "ping", socket }, keepAliveAfter(socket)], hint };
};

const hintAfter = (hint: Hint, event: HintEvent, now: number): HintStep => {
  switch (event.kind) {
    case "connect":
    case "close":
    case "online":
    case "offline":
    case "retry": {
      return wantAfter(hint, event);
    }
    case "ticketed":
    case "dialled": {
      return tryEventAfter(hint, event);
    }
    default: {
      return socketEventAfter(hint, event, now);
    }
  }
};

export const createSocketHint = (args: SocketHintArgs): SocketHint => {
  const { clock } = args;
  let hint: Hint = { kind: "idle", online: true };
  // the one timer belongs to the hint that armed it, so a step to another kind cancels it
  let cancelTimer: (() => void) | null = null;

  const ticketFor = async (asked: Ticketing, step: (event: HintEvent) => void): Promise<void> => {
    let ticket: string | null = null;
    try {
      ticket = await args.ticket();
    } catch {
      // no ticket this time: the try waits and goes again
    }
    step({ asked, kind: "ticketed", ticket });
  };

  const dialFor = (asked: Ticketing, ticket: string, step: (event: HintEvent) => void): void => {
    const socket = args.dial(socketUrl(args.origin, ticket));
    socket.addEventListener("open", () => {
      step({ kind: "opened", socket });
    });
    socket.addEventListener("message", ({ data }) => {
      step({ data, kind: "heard", socket });
    });
    socket.addEventListener("close", () => {
      step({ kind: "closed", socket });
    });
    step({ asked, kind: "dialled", socket });
  };

  const run = (effect: HintEffect, step: (event: HintEvent) => void): void => {
    switch (effect.kind) {
      case "ticket": {
        void ticketFor(effect.asked, step);
        break;
      }
      case "dial": {
        dialFor(effect.asked, effect.ticket, step);
        break;
      }
      case "after": {
        cancelTimer?.();
        cancelTimer = clock.after(effect.ms, () => {
          step(effect.event);
        });
        break;
      }
      case "ping": {
        effect.socket.send(SOCKET_KEEPALIVE_PING);
        break;
      }
      case "shut": {
        effect.socket.close();
        break;
      }
      case "status": {
        args.onStatus(effect.status);
        break;
      }
      case "frame": {
        args.onFrame(effect.frame);
        break;
      }
      // no default
    }
  };

  const step = (event: HintEvent): void => {
    const { effects, hint: next } = hintAfter(hint, event, clock.now());
    if (next.kind !== hint.kind) {
      cancelTimer?.();
      cancelTimer = null;
    }
    hint = next;
    for (const effect of effects) {
      run(effect, step);
    }
  };

  return {
    close: () => {
      step({ kind: "close" });
    },
    connect: () => {
      step({ kind: "connect" });
    },
    offline: () => {
      step({ kind: "offline" });
    },
    online: () => {
      step({ kind: "online" });
    },
  };
};
