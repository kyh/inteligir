// The library tab's layout, above the workspace and Settings alike, so Settings and back keeps one
// theme, one toaster, one confirm host, one host of a command's asks, one notice of writes waiting
// for a connection, one of the Mac app's update and the browser's ask as the tab closes on an
// import (CLAUDE.md § Window-level hosts mount in the library's layout), over the QueryClient and
// the library the tab opened once (`library-tab.ts`). Settings draws in a full-window layer over a
// workspace it leaves mounted and inert (CLAUDE.md § Where the tab is rides the URL, and Settings
// covers a workspace that stays mounted).

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { use, useState, useSyncExternalStore } from "react";

import { ThemeProvider } from "#components/theme-provider";

import { PageLibraryProvider, useLibraryQueries } from "./cloud/library-context";
import { PausedWrites } from "./cloud/needs-connection";
import { OpenFailedPage } from "./cloud/open-failed-page";
import { DesktopUpdateBanner } from "./desktop-update-banner";
import { useImportUnloadAsk } from "./import/import-run";
import { installPageEditorHost } from "./item/page-editor-host";
import { AskDialogHost } from "./library/ask-dialog-host";
import { LibraryCommandsProvider } from "./library/library-commands";
import { shownScope } from "./library-address";
import { libraryGoes, useLibraryAddress } from "./library-history";
import { pageTab } from "./library-tab";
import type { TabOpening } from "./library-tab";
import { SettingsPage } from "./settings/settings-page";
import { Workspace } from "./workspace";

// the floor spares a page the Worker served, so a tab it refuses is a browser too old to mark its
// calls as that page's, and a sign-in would send it straight back here
const TOO_OLD =
  "This browser is too old to open your library. Update it, or open the library in another browser.";

const WorkspaceLayout = () => {
  const { kind, openItem, scope, settings } = useLibraryAddress();
  const listed = useQuery(useLibraryQueries().scopes()).data;
  return (
    <>
      <Workspace
        scope={shownScope(scope, listed)}
        kind={kind}
        openItem={openItem}
        covered={settings}
      />
      {settings ? (
        <div className="fixed inset-0 bg-surface text-ink">
          <SettingsPage />
        </div>
      ) : null}
    </>
  );
};

type Opened = Extract<TabOpening, { kind: "open" }>;

const OpenLibrary = ({ library, queryClient }: Opened) => {
  // installed as the library first renders, ahead of its children: an open item's editor reads the
  // host as it renders
  // oxlint-disable-next-line react/hook-use-state -- a once-a-mount install: React's lazy initializer, with no value to keep
  useState(() => {
    const { cloud, wire, workspace } = library;
    installPageEditorHost({
      cloud,
      goes: libraryGoes,
      queryClient,
      wire,
      workspace,
    });
  });
  useImportUnloadAsk(library.session);
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

export const LibraryLayout = ({ opening }: { readonly opening: TabOpening }) => (
  <div data-library>
    {opening.kind === "open" ? <OpenLibrary {...opening} /> : null}
    {opening.kind === "unreached" ? <OpenFailedPage reload={reload} /> : null}
  </div>
);

// the page's, over the tab opened once a document
const OpenedLibrary = () => <LibraryLayout opening={use(pageTab.opening)} />;

export default OpenedLibrary;
