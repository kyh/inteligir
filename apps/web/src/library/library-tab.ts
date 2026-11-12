// The library's tab, in a browser or the Mac app's window alike, opened once a document whatever
// library route it opens on: it reads the session the site's sign-in left and makes the wire, the
// account's socket and the QueryClient every library route shares, and with no session sends the
// browser to the site's sign-in, which brings it back here. Sign-in is the first run: there is
// nothing to choose before it. Where the tab's session stands after that is one value, moved by
// one step (`tabAfter`) whichever way the page meets its end.

import type { Clock } from "@repo/contract/library/account-socket";
import type { SessionEnd } from "@repo/contract/library/call-outcome";
import { onlineManager } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { activeSession, keepSession, SIGN_IN_PATH, signInHref } from "#lib/auth-client";
import type { SessionState } from "#lib/auth-client";

import { claimAccountStorage, forgetAccountStorage } from "./cloud/account-storage";
import { createLeaveGuard } from "./cloud/leave-guard";
import type { LeaveGuard } from "./cloud/leave-guard";
import type { LeaveReason, PageLibrary } from "./cloud/library-context";
import type { FileCloud } from "./cloud/library-files";
import { pageClock } from "./cloud/page-clock";
import { createLibrarySocket } from "./cloud/use-library-socket";
import { createCloudWire, createPageQueryClient } from "./cloud/v1";
import type { CloudWire } from "./cloud/v1";
import { installLightPrints } from "./light-prints";
import { applyStoredSpellcheck } from "./spellcheck";

// where the tab's session stands: live; ended by the cloud, an `outdated` end keeping the session
// and saying the browser is too old, any other sending the tab to sign in; or left, by this
// device's own sign-out or its account deleted. The first end wins, and every later one does
// nothing
type TabSession =
  | { readonly kind: "live" }
  | { readonly kind: "ended"; readonly why: SessionEnd }
  | { readonly kind: "left" };

type TabEnd =
  | { readonly kind: "ended"; readonly why: SessionEnd }
  | { readonly kind: "left"; readonly why: LeaveReason };

// the guard asks nothing more, the account's storage on this device goes, and the page goes `to`
type TabEffect =
  | { readonly kind: "drop" | "forget" }
  | { readonly kind: "go"; readonly to: string };

interface TabStep {
  readonly session: TabSession;
  readonly effects: readonly TabEffect[];
}

interface TabSessionStore {
  readonly get: () => TabSession;
  readonly subscribe: (heard: () => void) => () => void;
}

export type TabOpening =
  | {
      readonly kind: "open";
      readonly library: PageLibrary;
      readonly queryClient: QueryClient;
      readonly session: TabSessionStore;
    }
  // the site or the connection failed before anything was drawn
  | { readonly kind: "unreached" };

// the floor spares a page the Worker served by a header only a browser this old leaves out, and
// the sign-in would send a tab it signed in straight back here, so that tab keeps its session; a
// session that ended leaves nothing the tab could still send, so the browser does not ask
const tabAfter = (
  session: TabSession,
  end: TabEnd,
  here: Pick<Location, "pathname" | "search">,
): TabStep => {
  if (session.kind !== "live") {
    return { effects: [], session };
  }
  if (end.kind === "left") {
    return {
      effects: [
        { kind: "forget" },
        { kind: "drop" },
        { kind: "go", to: end.why === "deleted" ? "/" : SIGN_IN_PATH },
      ],
      session: { kind: "left" },
    };
  }
  return {
    effects:
      end.why === "outdated"
        ? [{ kind: "drop" }]
        : [{ kind: "drop" }, { kind: "forget" }, { kind: "go", to: signInHref(here) }],
    session: { kind: "ended", why: end.why },
  };
};

interface TabSessionArgs {
  readonly clock: Clock;
  // Better Auth's own read, which a keeper makes on a timer so an idle page finds out too
  readonly read: () => Promise<SessionState>;
  readonly guard: Pick<LeaveGuard, "drop">;
  readonly forget: () => void;
  readonly location: Pick<Location, "assign" | "pathname" | "search">;
}

export const createTabSession = ({ clock, read, guard, forget, location }: TabSessionArgs) => {
  let session: TabSession = { kind: "live" };
  const listeners = new Set<() => void>();
  const end = (cause: TabEnd): void => {
    const next = tabAfter(session, cause, location);
    if (next.session === session) {
      return;
    }
    ({ session } = next);
    for (const effect of next.effects) {
      switch (effect.kind) {
        case "drop": {
          guard.drop();
          break;
        }
        case "forget": {
          forget();
          break;
        }
        case "go": {
          location.assign(effect.to);
          break;
        }
        // no default
      }
    }
    for (const heard of listeners) {
      heard();
    }
  };
  keepSession(clock, async () => {
    const { kind } = await read();
    if (kind === "signed-out") {
      end({ kind: "ended", why: "signed-out" });
    }
  });
  const store: TabSessionStore = {
    get: () => session,
    subscribe: (heard) => {
      listeners.add(heard);
      return () => {
        listeners.delete(heard);
      };
    },
  };
  return { end, store };
};

const readSession = async (): Promise<SessionState | null> => {
  try {
    return await activeSession();
  } catch {
    return null;
  }
};

const open = async (): Promise<TabOpening> => {
  // before the first paint: a stored "off" must not flash red underlines
  applyStoredSpellcheck();
  installLightPrints();
  const { origin } = window.location;
  const session = await readSession();
  // a fault of the site's says neither signed in nor out, so it never sends a signed-in person to
  // sign in again
  if (session === null || session.kind === "unknown") {
    return { kind: "unreached" };
  }
  if (session.kind === "signed-out") {
    // a session ends with no tab open too, so nothing else saw it go
    forgetAccountStorage();
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirect() is thrown as it returns it (tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes)
    throw redirect({ href: signInHref(window.location), reloadDocument: true });
  }
  const { user } = session;
  claimAccountStorage(user.id);
  const leave = createLeaveGuard(window);
  const tab = createTabSession({
    clock: pageClock,
    forget: forgetAccountStorage,
    guard: leave,
    location: window.location,
    read: activeSession,
  });
  const sessionEnded = (why: SessionEnd): void => {
    tab.end({ kind: "ended", why });
  };
  const cloud: FileCloud = {
    fetch: async (request) => await fetch(request),
    onSessionEnd: sessionEnded,
    origin,
  };
  const wire = createCloudWire(cloud, sessionEnded);
  const queryClient = createPageQueryClient();
  const socket = createLibrarySocket({
    clock: pageClock,
    dial: (url) => new WebSocket(url),
    origin,
    queryClient,
    wire,
  });
  const library: PageLibrary = {
    account: { email: user.email, name: user.name },
    cloud,
    leave,
    left: (why) => {
      tab.end({ kind: "left", why });
    },
    socket,
    wire,
  };
  return { kind: "open", library, queryClient, session: tab.store };
};

// what a route's screen reads first, asked once as the route loads over the options the screen
// reads with, waiting for one answer and not the retries the screen's own query makes; a read whose
// seed failed draws its own refusal, so it is not the route's failure, and with no connection
// nothing is awaited and each read says it needs one. `seed` is generic, since the reads answer
// different shapes and a list of them has no one options type
export const seedReads = async (
  opening: TabOpening,
  reads: (seed: QueryClient["query"], wire: CloudWire) => readonly Promise<unknown>[],
): Promise<void> => {
  if (opening.kind !== "open" || !onlineManager.isOnline()) {
    return;
  }
  const { queryClient } = opening;
  await Promise.allSettled(
    reads(
      async (options) => await queryClient.query({ ...options, retry: 0, staleTime: "static" }),
      opening.library.wire,
    ),
  );
};

let opening: Promise<TabOpening> | undefined;

// once a document, so Settings and back keeps one wire, one socket and one QueryClient
export const openTab = async (): Promise<TabOpening> => {
  opening ??= open();
  return await opening;
};
