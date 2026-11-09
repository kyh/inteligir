// The library's tab, in a browser or the Mac app's window alike, opened once a document whatever
// library route it opens on: it reads the session the site's sign-in left and makes the wire, the
// account's socket and the QueryClient every library route shares, and with no session sends the
// browser to the site's sign-in, which brings it back here. Sign-in is the first run: there is
// nothing to choose before it.

import type { SessionEnd } from "@repo/contract/library/call-outcome";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { activeSession, keepSession, SIGN_IN_PATH, signInHref } from "#lib/auth-client";
import type { SessionState } from "#lib/auth-client";

import { claimAccountStorage, forgetAccountStorage } from "./cloud/account-storage";
import { createPageAuth } from "./cloud/auth-client";
import { createLeaveGuard } from "./cloud/leave-guard";
import type { PageLibrary } from "./cloud/library-context";
import type { FileCloud } from "./cloud/library-files";
import { pageClock } from "./cloud/page-clock";
import { createLibrarySocket } from "./cloud/use-library-socket";
import { createCloudWire, createPageQueryClient } from "./cloud/v1";
import { installLightPrints } from "./light-prints";
import { applyStoredSpellcheck } from "./spellcheck";

// the build floor's refusal, which any call after the open can meet
interface FloorRefusal {
  readonly refused: () => boolean;
  readonly subscribe: (heard: () => void) => () => void;
}

export type TabOpening =
  | {
      readonly kind: "open";
      readonly library: PageLibrary;
      readonly queryClient: QueryClient;
      readonly floor: FloorRefusal;
    }
  // the site or the connection failed before anything was drawn
  | { readonly kind: "unreached" };

const createFloor = () => {
  const listeners = new Set<() => void>();
  let refused = false;
  const floor: FloorRefusal = {
    refused: () => refused,
    subscribe: (heard) => {
      listeners.add(heard);
      return () => {
        listeners.delete(heard);
      };
    },
  };
  const refuse = (): void => {
    refused = true;
    for (const heard of listeners) {
      heard();
    }
  };
  return { floor, refuse };
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
  keepSession(pageClock, async () => {
    await activeSession();
  });
  const leave = createLeaveGuard(window);
  const { floor, refuse } = createFloor();
  // the floor spares a page the Worker served by a header only a browser this old leaves out, and
  // the sign-in would send a tab it signed in straight back here, so that tab keeps its session;
  // a session that ended leaves nothing the tab could still send, so the browser does not ask
  const sessionEnded = (end: SessionEnd): void => {
    leave.drop();
    if (end === "outdated") {
      refuse();
      return;
    }
    forgetAccountStorage();
    window.location.assign(signInHref(window.location));
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
    auth: createPageAuth(cloud),
    cloud,
    leave,
    left: (reason) => {
      forgetAccountStorage();
      leave.drop();
      window.location.assign(reason === "deleted" ? "/" : SIGN_IN_PATH);
    },
    socket,
    wire,
  };
  return { floor, kind: "open", library, queryClient };
};

let opening: Promise<TabOpening> | undefined;

// once a document, so Settings and back keeps one wire, one socket and one QueryClient
export const openTab = async (): Promise<TabOpening> => {
  opening ??= open();
  return await opening;
};
