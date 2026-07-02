import { Suspense, lazy, useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { SidebarProvider } from "@repo/ui/components/sidebar";
import { Spinner } from "@repo/ui/components/spinner";

import { getBridge } from "@repo/app/lib/bridge";
import { CommandPalette } from "@repo/app/command/command-palette";
import { DelegationDock } from "@repo/app/delegation/delegation-dock";
import { BottomComposer } from "@repo/app/composer/bottom-composer";
import { EditorPane } from "@repo/app/editor/editor-pane";
import { Header } from "@repo/app/layout/header";
import { AppSidebar } from "@repo/app/sidebar/app-sidebar";
import { TabStrip } from "@repo/app/workspace/tab-strip";
import { VaultProvider, useVault } from "@repo/app/workspace/vault-context";
import { useAgentStore } from "@repo/app/stores/agent-store";
import { useDelegationStore } from "@repo/app/stores/delegation-store";
import { useViewStore } from "@repo/app/stores/view-store";
import { useVoiceStore } from "@repo/app/stores/voice-store";

// The graph view stays out of the main chunk: it (and its d3-force dependency)
// loads on first open.
const GraphView = lazy(() => import("@repo/app/workspace/graph-view"));

/** Tab keyboard shortcuts — mounted inside the VaultProvider: Cmd/Ctrl+W
 * closes the active tab, Ctrl(+Shift)+Tab cycles. (A plain browser reserves
 * Cmd/Ctrl+W for its own tabs; the Electron shell delivers it.) */
function TabHotkeys() {
  const { activeTab, closeTab, cycleTab } = useVault();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        if (activeTab === null) return;
        e.preventDefault();
        closeTab(activeTab);
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, closeTab, cycleTab]);

  return null;
}

/**
 * The workspace — the app's only surface. Two flush Attio-style panes: a
 * collapsible file-tree sidebar and a full-width editor (with a tab strip and
 * the AI composer pinned at the bottom); the link-graph view swaps in as an
 * alternate main surface. No chat column. Cmd+B toggles the sidebar; Cmd+K
 * opens the command palette.
 */
export function WorkspacePage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  const initDelegations = useDelegationStore((s) => s.init);
  useEffect(() => initDelegations(), [initDelegations]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const surface = useViewStore((s) => s.surface);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Recoverable error states (agent restart / logout) route back here.
  const appState = useAgentStore((s) => s.appState);
  const workspaceError =
    appState.phase === "error" && (appState.prev === "ready" || appState.prev === "logging_out")
      ? appState.message
      : null;

  const handleRetry = useCallback(() => {
    getBridge()?.transition({ type: "RETRY" });
  }, []);

  return (
    <VaultProvider>
      <SidebarProvider className="bg-sidebar">
        <AppSidebar onOpenPalette={() => setPaletteOpen(true)} />
        {/* Flush Attio-style editor pane: a full-height column butted against
         * the sidebar's right border. This div is the positioning context for
         * the bottom composer and the error banner. */}
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
          <Header />

          {workspaceError !== null && (
            <div className="absolute inset-x-0 top-14 z-30 flex justify-center px-8">
              <div className="flex max-w-xl items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5">
                <span className="truncate text-xs text-destructive" title={workspaceError}>
                  {workspaceError}
                </span>
                <Button size="sm" variant="tertiary" className="shrink-0" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            </div>
          )}

          {surface === "editor" && <TabStrip />}
          <main className="min-h-0 flex-1 overflow-auto">
            {surface === "graph" ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spinner className="size-5 text-muted-foreground" />
                  </div>
                }
              >
                <GraphView />
              </Suspense>
            ) : (
              <EditorPane />
            )}
          </main>
          <DelegationDock />
          <BottomComposer />
        </div>
        <TabHotkeys />
      </SidebarProvider>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </VaultProvider>
  );
}
