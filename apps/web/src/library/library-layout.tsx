// The library route's layout, above every library route, so Settings and back keeps one theme, one
// toaster, one confirm host, one notice of writes waiting for a connection and one of the Mac app's
// update (CLAUDE.md § WINDOW-LEVEL HOSTS MOUNT IN THE LIBRARY'S LAYOUT), over the QueryClient and
// the library the tab opened once (`library-tab.ts`). The covering child draws in a full-window
// layer here rather than in its own component, so its crash boundary lands in the layer too instead
// of below a workspace it left inert (CLAUDE.md § THE OPEN ITEM RIDES THE URL, AND SETTINGS COVERS A
// WORKSPACE THAT STAYS MOUNTED).

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { getRouteApi, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { ThemeProvider } from "#components/theme-provider";

import { AppearanceProvider } from "./appearance";
import { PageLibraryProvider } from "./cloud/library-context";
import { libraryQueries } from "./cloud/library-queries";
import { PausedWrites } from "./cloud/needs-connection";
import { OpenFailedPage } from "./cloud/open-failed-page";
import { DesktopUpdateBanner } from "./desktop-update-banner";
import { seedReads } from "./library-tab";
import type { TabOpening } from "./library-tab";
import { Workspace } from "./workspace";

const libraryRoute = getRouteApi("/library");

// the floor spares a page the Worker served, so a tab it refuses is a browser too old to mark its
// calls as that page's, and a sign-in would send it straight back here
const TOO_OLD =
  "This browser is too old to open your library. Update it, or open the library in another browser.";

const WorkspaceLayout = () => {
  const { item } = libraryRoute.useSearch();
  const navigate = useNavigate();
  // any child but the index draws over the workspace
  const covered = useMatch({ from: "/library/", shouldThrow: false }) === undefined;
  return (
    <>
      <Workspace
        openItem={item ?? null}
        covered={covered}
        onOpenItem={(itemId) => {
          // on the current route: an open that lands while Settings covers the workspace keeps it
          void navigate({ search: (prior) => ({ ...prior, item: itemId ?? undefined }), to: "." });
        }}
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

const OpenLibrary = ({ library, queryClient, session }: Opened) => {
  const standing = useSyncExternalStore(session.subscribe, session.get);
  if (standing.kind === "ended" && standing.why === "outdated") {
    return TOO_OLD;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <PageLibraryProvider library={library}>
        <ThemeProvider>
          <SizeProvider size="compact">
            <AppearanceProvider>
              <MotionPolicy>
                <TooltipProvider>
                  <WorkspaceLayout />
                  <ConfirmDialogHost />
                  <Toaster position="bottom-right" />
                  <PausedWrites />
                  <DesktopUpdateBanner />
                </TooltipProvider>
              </MotionPolicy>
            </AppearanceProvider>
          </SizeProvider>
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
