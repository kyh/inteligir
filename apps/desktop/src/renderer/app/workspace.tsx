import type { Thread } from "@repo/contract/local/threads/threads-schema";
import { Button } from "@repo/ui/components/button";
import { Sidebar } from "@repo/ui/components/sidebar";
import { SidebarInset, SidebarProvider, useSidebar } from "@repo/ui/components/sidebar-core";
import type { SidebarActions } from "@repo/ui/components/sidebar-core";
import { cn } from "@repo/ui/lib/cn";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActionComposer } from "./actions/action-composer";
import { ActionsPanel } from "./actions/actions-panel";
import type { PanelTab } from "./actions/actions-panel";
import { useThreads } from "./actions/thread-hooks";
import { useCloudSession } from "./cloud-session";
import { bindingFor, useGlobalShortcuts } from "./global-shortcuts";
import { CommandPalette } from "./palette/command-palette";
import type { PaletteEntry, PaletteRequest } from "./palette/command-palette";
import { PREFS, readPref, usePref, writePref } from "./prefs";
import type { SettingsSection } from "./settings/settings-page";
import { SidebarRailContent } from "./sidebar/sidebar";
import { hasInsetTitleBar } from "./title-bar";

export interface WorkspaceProps {
  // another surface draws over the workspace: it goes inert and its window-level chords stand
  // down. Its root isolates the z-indices inside, so a later sibling covers every one of them.
  covered: boolean;
}

const EMPTY_THREADS: readonly Thread[] = [];

// rendered inside the panel's provider, so `useSidebar()` here is the panel's
const PanelToggle = () => {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label="Toggle panel"
      onClick={() => {
        toggleSidebar();
      }}
    >
      <PanelRightIcon />
    </Button>
  );
};

// The centre column's bar: the rail's toggle, and the panel's. With the rail closed this bar is
// the window's top-left corner, where the traffic lights sit.
const WorkspaceTopbar = ({
  railOpen,
  onToggleRail,
  insetTitleBar,
}: {
  railOpen: boolean;
  onToggleRail: () => void;
  insetTitleBar: boolean;
}) => (
  <header
    className={cn(
      "flex h-[var(--app-header-h)] shrink-0 items-center gap-0.5 border-b border-line px-1.5",
      insetTitleBar && !railOpen && "pl-[4.5rem]",
    )}
  >
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label={railOpen ? "Collapse the sidebar" : "Expand the sidebar"}
      aria-expanded={railOpen}
      onClick={onToggleRail}
    >
      <PanelLeftIcon />
    </Button>
    <div className="min-w-0 flex-1" data-tauri-drag-region />
    <PanelToggle />
  </header>
);

// What the centre shows until something more lives there: the way to ask the agent.
const AskTheAgent = ({
  modifier,
  onAskAgent,
}: {
  modifier: ShortcutModifier;
  onAskAgent: () => void;
}) => (
  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
    <p className="text-subtitle text-muted-foreground">
      Press {bindingFor("open-action-composer", modifier)} to ask the agent. Its actions show in the
      panel.
    </p>
    <Button
      variant="secondary"
      size="compact"
      leadingIcon={MessageSquarePlusIcon}
      onClick={onAskAgent}
    >
      Ask the agent
    </Button>
  </div>
);

export const Workspace = ({ covered }: WorkspaceProps) => {
  // Each open is a fresh request, keyed by its nonce so the palette mounts clean. A close keeps
  // the last request mounted with `open` off, because unmounting the dialog cuts its exit tween;
  // the next open replaces it.
  const [palette, setPalette] = useState<{ request: PaletteRequest; open: boolean } | null>(null);
  const openPalette = useCallback((entry: PaletteEntry): void => {
    setPalette((current) => ({
      open: true,
      request: { ...entry, nonce: (current?.request.nonce ?? 0) + 1 },
    }));
  }, []);
  const closePalette = useCallback((): void => {
    setPalette((current) => (current === null ? null : { ...current, open: false }));
  }, []);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [shortcutModifier] = useState(platformShortcutModifier);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);

  const threadsQuery = useThreads();
  const [composerOpen, setComposerOpen] = useState(false);
  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = usePref(PREFS.panelOpen);
  const [panelTab, setPanelTab] = useState<PanelTab>("actions");
  const [railOpen, setRailOpen] = useState(true);

  // the toggles the providers own, since below the mobile breakpoint a side is a sheet whose open
  // state only its provider holds
  const railActionsRef = useRef<SidebarActions | null>(null);
  const panelActionsRef = useRef<SidebarActions | null>(null);
  const centreRef = useRef<HTMLElement | null>(null);

  // One verb for every entry that shows a thread in the panel: it starts closed, so an entry that
  // only picks its thread shows nothing.
  const openThread = useCallback(
    (threadId: string): void => {
      setPanelOpen(true);
      setPanelTab("actions");
      setPanelThreadId(threadId);
    },
    [setPanelOpen],
  );

  const askAgent = useCallback((): void => {
    setComposerOpen(true);
  }, []);

  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [initialSidebarWidth] = useState(() => `${String(readPref(PREFS.sidebarWidth))}px`);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [initialPanelWidth] = useState(() => `${String(readPref(PREFS.panelWidth))}px`);

  const session = useCloudSession();
  const canSync = session.status?.state === "signed-in" && !session.pending;

  const navigate = useNavigate();
  // Settings covers a workspace that stays mounted. The palette is portaled, so the cover would
  // not hide it: it closes here.
  const onOpenSettings = useCallback(
    (section?: SettingsSection): void => {
      closePalette();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // the router scrolls a hash's anchor into view once the page has rendered
      if (section === undefined) {
        void navigate({ to: "/settings" });
      } else {
        void navigate({ hash: section, to: "/settings" });
      }
    },
    [closePalette, navigate],
  );

  useGlobalShortcuts({ enabled: !covered, modifier: shortcutModifier }, (action) => {
    switch (action) {
      case "open-action-composer": {
        setComposerOpen((current) => !current);
        break;
      }
      case "open-palette": {
        if (palette?.open === true) {
          closePalette();
        } else {
          openPalette({ page: "root" });
        }
        break;
      }
      case "open-settings": {
        onOpenSettings();
        break;
      }
      case "toggle-rail": {
        railActionsRef.current?.toggle();
        break;
      }
      case "toggle-panel": {
        panelActionsRef.current?.toggle();
        break;
      }
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  });

  const { syncThreads } = session;
  const paletteActions = useMemo(
    () => ({
      askAgent,
      openSettings: () => {
        onOpenSettings();
      },
      openThread,
      syncNow: syncThreads,
    }),
    [askAgent, onOpenSettings, openThread, syncThreads],
  );

  const threads = threadsQuery.data ?? EMPTY_THREADS;

  return (
    <div inert={covered} className="isolate flex h-dvh flex-col bg-surface text-ink">
      <SidebarProvider
        className="min-h-0 flex-1 overflow-hidden"
        open={railOpen}
        onOpenChange={setRailOpen}
        shortcut={bindingFor("toggle-rail", shortcutModifier)}
        onWidthCommitted={(px) => {
          writePref(PREFS.sidebarWidth, px);
        }}
        actionsRef={railActionsRef}
        peek="click"
        width={initialSidebarWidth}
      >
        <Sidebar variant="floating" className="h-full">
          <SidebarRailContent
            selectedThreadId={panelThreadId}
            onOpenThread={openThread}
            onAskAgent={askAgent}
            onOpenSearch={() => {
              openPalette({ page: "root" });
            }}
            searchShortcut={bindingFor("open-palette", shortcutModifier)}
            onOpenSettings={onOpenSettings}
          />
        </Sidebar>
        <SidebarInset className="relative bg-surface">
          <SidebarProvider
            className="min-h-0 h-full flex-1"
            open={panelOpen}
            onOpenChange={setPanelOpen}
            shortcut={bindingFor("toggle-panel", shortcutModifier)}
            onWidthCommitted={(px) => {
              writePref(PREFS.panelWidth, px);
            }}
            actionsRef={panelActionsRef}
            width={initialPanelWidth}
          >
            <SidebarInset ref={centreRef} className="relative bg-surface">
              <WorkspaceTopbar
                railOpen={railOpen}
                onToggleRail={() => {
                  railActionsRef.current?.toggle();
                }}
                insetTitleBar={insetTitleBar}
              />
              <AskTheAgent modifier={shortcutModifier} onAskAgent={askAgent} />
              <ActionComposer
                open={composerOpen}
                onOpenChange={(next) => {
                  // a press or an Escape in the layer over a covered workspace is not one at
                  // the composer, which the way back finds as it was left
                  if (next || !covered) {
                    setComposerOpen(next);
                  }
                }}
                onLaunched={openThread}
                container={centreRef}
              />
            </SidebarInset>
            <Sidebar side="right" className="h-full">
              <ActionsPanel
                tab={panelTab}
                onTabChange={setPanelTab}
                selectedThreadId={panelThreadId}
                onSelectThread={setPanelThreadId}
                modifier={shortcutModifier}
              />
            </Sidebar>
          </SidebarProvider>
        </SidebarInset>
        {palette === null ? null : (
          <CommandPalette
            key={palette.request.nonce}
            open={palette.open}
            request={palette.request}
            modifier={shortcutModifier}
            onOpenChange={(open) => {
              if (!open) {
                closePalette();
              }
            }}
            threads={threads}
            canSync={canSync}
            actions={paletteActions}
          />
        )}
      </SidebarProvider>
    </div>
  );
};
