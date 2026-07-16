import { Suspense, lazy, useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { SidebarProvider } from "@repo/ui/components/sidebar";
import { Spinner } from "@repo/ui/components/spinner";

import { getBridge } from "@renderer/lib/bridge";
import { CommandPalette } from "@renderer/command/command-palette";
import { DelegationDock } from "@renderer/delegation/delegation-dock";
import { BottomComposer } from "@renderer/composer/bottom-composer";
import { SaveIndicator } from "@renderer/workspace/save-indicator";
import { EditorPane } from "@renderer/editor/editor-pane";
import { Header } from "@renderer/layout/header";
import { AppSidebar } from "@renderer/sidebar/app-sidebar";
import { HtmlAppView } from "@renderer/workspace/html-app-view";
import { useDeepLinkNav } from "@renderer/workspace/use-deep-link";
import { useOpenDailyNote } from "@renderer/workspace/use-note-templates";
import { VaultProvider, useVault } from "@renderer/workspace/vault-context";
import { useAgentStore } from "@renderer/stores/agent-store";
import { useDelegationStore } from "@renderer/stores/delegation-store";
import { useViewStore } from "@renderer/stores/view-store";
import { useVoiceStore } from "@renderer/stores/voice-store";

// The graph view stays out of the main chunk: it (and its d3-force dependency)
// loads on first open.
const GraphView = lazy(() => import("@renderer/workspace/graph-view"));

/** The main surface: the graph, an HTML App (open `.html` shown as an app), or
 * the editor. Lives inside VaultProvider so it can read `isHtmlApp`. */
function MainSurface({ surface }: { surface: "editor" | "graph" }) {
  const { isHtmlApp } = useVault();
  if (surface === "graph") {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        }
      >
        <GraphView />
      </Suspense>
    );
  }
  return isHtmlApp ? <HtmlAppView /> : <EditorPane />;
}

/** inteligir:// nav verbs (today / note / search). Lives inside VaultProvider
 * so it can open notes; search opens the palette prefilled; renders nothing. */
function DeepLinkNav({ onSearch }: { onSearch: (query: string) => void }) {
  useDeepLinkNav(onSearch);
  return null;
}

/** ⌘D / Ctrl+D → open-or-create today's daily note. Lives inside VaultProvider
 * so it can reach the vault + the Settings → Notes config; renders nothing. */
function DailyNoteHotkey() {
  const openDailyNote = useOpenDailyNote();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        openDailyNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDailyNote]);
  return null;
}

/**
 * The workspace — the app's only surface. Two flush Attio-style panes: a
 * collapsible file-tree sidebar and a full-width single-document editor (with
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
  // Deep-link search prefill: the seed rides into the palette once per
  // delivery, then clears (consumed) so a later ⌘K opens clean.
  const [paletteSeed, setPaletteSeed] = useState<string | null>(null);
  const openSearch = useCallback((query: string) => {
    setPaletteSeed(query);
    setPaletteOpen(true);
  }, []);
  const consumeSeed = useCallback(() => setPaletteSeed(null), []);
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
      <DailyNoteHotkey />
      <DeepLinkNav onSearch={openSearch} />
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
                <Button size="sm" variant="outline" className="shrink-0" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            </div>
          )}

          <main className="min-h-0 flex-1 overflow-auto">
            <MainSurface surface={surface} />
          </main>
          <DelegationDock />
          <BottomComposer />
          <SaveIndicator />
        </div>
      </SidebarProvider>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        seedQuery={paletteSeed}
        onSeedConsumed={consumeSeed}
      />
    </VaultProvider>
  );
}
