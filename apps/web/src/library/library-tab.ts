import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { SIGN_IN_PATH } from "@repo/contract/library-page";
import { createLibraryChanges } from "@repo/client/library-changes";
import { onlineManager } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createStore } from "zustand/vanilla";

import { activeSession, keepSession } from "#lib/auth-client";
import type { SessionState } from "#lib/auth-client";
import { signInHref } from "#lib/next-path";

import { claimAccountStorage, forgetAccountStorage } from "./cloud/account-storage";
import type {
  LeaveReason,
  PageLibrary,
  TabSession,
  TabSessionStore,
} from "./cloud/library-context";
import type { FileCloud } from "./cloud/library-files";
import { libraryQueries } from "./cloud/library-queries";
import { createCloudWire, createPageQueryClient } from "./cloud/v1";
import { followDevicePrefs } from "./document-prefs";
import { createWorkspaceStore } from "./workspace-store";

type TabEnd =
  | { readonly kind: "ended"; readonly why: SessionEnd }
  | { readonly kind: "left"; readonly why: LeaveReason };

type TabEffect = { readonly kind: "forget" } | { readonly kind: "go"; readonly to: string };

interface TabStep {
  readonly session: TabSession;
  readonly effects: readonly TabEffect[];
}

export type TabOpening =
  | { readonly kind: "open"; readonly library: PageLibrary; readonly queryClient: QueryClient }
  | { readonly kind: "unreached" }
  | { readonly kind: "leaving" };

const tabAfter = (
  session: TabSession,
  end: TabEnd,
  here: Pick<Location, "pathname" | "search">,
) => {
  if (session.kind !== "live") {
    return { effects: [], session } satisfies TabStep;
  }

  if (end.kind === "left") {
    return {
      effects: [{ kind: "forget" }, { kind: "go", to: end.why === "deleted" ? "/" : SIGN_IN_PATH }],
      session: { kind: "left" },
    } satisfies TabStep;
  }

  return {
    effects:
      end.why === "outdated" ? [] : [{ kind: "forget" }, { kind: "go", to: signInHref(here) }],
    session: { kind: "ended", why: end.why },
  } satisfies TabStep;
};

interface TabSessionArgs {
  readonly read: () => Promise<SessionState>;
  readonly forget: () => void;
  readonly location: Pick<Location, "assign" | "pathname" | "search">;
}

export const createTabSession = ({ read, forget, location }: TabSessionArgs) => {
  const standing = createStore<TabSession>()(() => ({ kind: "live" }));

  const end = (cause: TabEnd) => {
    const now = standing.getState();
    const next = tabAfter(now, cause, location);

    if (next.session === now) {
      return;
    }

    standing.setState(next.session, true);

    for (const effect of next.effects) {
      switch (effect.kind) {
        case "forget": {
          forget();
          break;
        }

        case "go": {
          location.assign(effect.to);
          break;
        }

        default: {
          throw new Error(`unexpected ${String(effect satisfies never)}`);
        }
      }
    }
  };

  keepSession(async () => {
    const { kind } = await read();

    if (kind === "signed-out") {
      end({ kind: "ended", why: "signed-out" });
    }
  });

  const store: TabSessionStore = { get: standing.getState, subscribe: standing.subscribe };

  return { end, store };
};

const open = async () => {
  followDevicePrefs(document.documentElement);
  const { origin } = window.location;
  const session = await activeSession();

  if (session.kind === "unknown") {
    return { kind: "unreached" } satisfies TabOpening;
  }

  if (session.kind === "signed-out") {
    forgetAccountStorage();
    window.location.assign(signInHref(window.location));

    return { kind: "leaving" } satisfies TabOpening;
  }

  const { user } = session;
  claimAccountStorage(user.id);

  const tab = createTabSession({
    forget: forgetAccountStorage,
    location: window.location,
    read: activeSession,
  });

  const sessionEnded = (why: SessionEnd) => {
    tab.end({ kind: "ended", why });
  };

  const cloud: FileCloud = {
    fetch: async (request) => await fetch(request),
    onSessionEnd: sessionEnded,
    origin,
  };

  const wire = createCloudWire(cloud, sessionEnded);
  const queryClient = createPageQueryClient();
  const changes = createLibraryChanges({ client: wire.client, queries: wire.orpc, queryClient });

  const library: PageLibrary = {
    account: { email: user.email, name: user.name },
    changes,
    cloud,
    left: (why) => {
      tab.end({ kind: "left", why });
    },
    session: tab.store,
    wire,
    workspace: createWorkspaceStore(),
  };

  if (onlineManager.isOnline()) {
    await changes.poll();
    await Promise.allSettled([
      queryClient.query({ ...libraryQueries(wire).scopes(), retry: 0, staleTime: "static" }),
    ]);
  }

  return { kind: "open", library, queryClient } satisfies TabOpening;
};

let opening: Promise<TabOpening> | undefined;

export const pageTab = {
  get opening() {
    opening ??= open();

    return opening;
  },
};
