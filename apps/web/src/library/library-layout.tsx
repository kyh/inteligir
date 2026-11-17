// The library route's layout, above every library route, so Settings and back keeps one theme, one
// toaster, one confirm host, one host of a command's asks, one notice of writes waiting for a
// connection and one of the Mac app's update (CLAUDE.md § Window-level hosts mount in the library's
// layout), over the QueryClient and the library the tab opened once (`library-tab.ts`). The covering
// child draws in a full-window layer here rather than in its own component, so its crash boundary
// lands in the layer too instead of below a workspace it left inert (CLAUDE.md § Where the tab is
// rides the URL, and Settings covers a workspace that stays mounted).

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { getRouteApi, Outlet, useMatch, useRouter } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";

import { ThemeProvider } from "#components/theme-provider";

import { PageLibraryProvider, useLibraryQueries } from "./cloud/library-context";
import { libraryQueries } from "./cloud/library-queries";
import { PausedWrites } from "./cloud/needs-connection";
import { OpenFailedPage } from "./cloud/open-failed-page";
import { DesktopUpdateBanner } from "./desktop-update-banner";
import { installPageEditorHost } from "./item/page-editor-host";
import { AskDialogHost } from "./library/ask-dialog-host";
import { LibraryCommandsProvider } from "./library/library-commands";
import { libraryGoes, placeOf, shownScope } from "./library-place";
import { seedReads } from "./library-tab";
import type { TabOpening } from "./library-tab";
import { Workspace } from "./workspace";

const libraryRoute = getRouteApi("/library");

// the floor spares a page the Worker served, so a tab it refuses is a browser too old to mark its
// calls as that page's, and a sign-in would send it straight back here
const TOO_OLD =
  "This browser is too old to open your library. Update it, or open the library in another browser.";

const WorkspaceLayout = () => {
  const { kind, openItem, scope } = placeOf(libraryRoute.useSearch());
  const listed = useQuery(useLibraryQueries().scopes()).data;
  // any child but the index draws over the workspace
  const covered = useMatch({ from: "/library/", shouldThrow: false }) === undefined;
  return (
    <>
      <Workspace
        scope={shownScope(scope, listed)}
        kind={kind}
        openItem={openItem}
        covered={covered}
      />
      {covered ? (
        <div className="fixed inset-0 bg-surface text-ink">
          <Outlet />
        </div>
      ) : null}
    </>
  );
};

type Opened = Extract<TabOpening, { kind: "open" }>;

const OpenLibrary = ({ library, queryClient }: Opened) => {
  const router = useRouter();
  // installed as the library first renders, ahead of its children: an open item's editor reads the
  // host as it renders, and the router it navigates by is React's to hand over
  // oxlint-disable-next-line react/hook-use-state -- a once-a-mount install: React's lazy initializer, with no value to keep
  useState(() => {
    const { cloud, wire, workspace } = library;
    installPageEditorHost({
      cloud,
      goes: libraryGoes(router),
      queryClient,
      wire,
      workspace,
    });
  });
  const standing = useSyncExternalStore(library.session.subscribe, library.session.get);
  if (standing.kind === "ended" && standing.why === "outdated") {
    return TOO_OLD;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <PageLibraryProvider library={library}>
        <ThemeProvider>
          <MotionPolicy>
            <TooltipProvider>
              <LibraryCommandsProvider>
                <WorkspaceLayout />
              </LibraryCommandsProvider>
              <ConfirmDialogHost />
              <AskDialogHost />
              <Toaster position="bottom-right" />
              <PausedWrites />
              <DesktopUpdateBanner />
            </TooltipProvider>
          </MotionPolicy>
        </ThemeProvider>
      </PageLibraryProvider>
    </QueryClientProvider>
  );
};

const reload = (): void => {
  window.location.reload();
};

export const LibraryLayout = () => {
  const opening = libraryRoute.useRouteContext({ select: (context) => context.opening });
  return (
    <div data-library>
      {opening.kind === "open" ? <OpenLibrary {...opening} /> : <OpenFailedPage reload={reload} />}
    </div>
  );
};

// the rail's scopes are read before the grid draws
export const seedScopes = async ({
  context: { opening },
}: {
  context: { opening: TabOpening };
}): Promise<void> => {
  await seedReads(opening, (seed, wire) => [seed(libraryQueries(wire).scopes())]);
};
