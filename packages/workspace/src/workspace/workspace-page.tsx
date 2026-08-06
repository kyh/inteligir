import { Suspense, lazy, useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { SidebarProvider } from "@repo/ui/components/sidebar";
import { Spinner } from "@repo/ui/components/spinner";

import { getBridge } from "@repo/bridge/client";
import { CommandPalette } from "@repo/workspace/command/command-palette";
import { requestSearch } from "@repo/editor/search-request";
import { DelegationDock } from "@repo/workspace/delegation/delegation-dock";
import { BottomComposer } from "@repo/workspace/composer/bottom-composer";
import { PastChatsDialog } from "@repo/workspace/composer/past-chats-dialog";
import { SaveIndicator } from "@repo/workspace/workspace/save-indicator";
import { EditorPane } from "@repo/editor/editor-pane";
import { Header } from "@repo/workspace/layout/header";
import { AppSidebar } from "@repo/workspace/sidebar/app-sidebar";
import { HtmlAppView } from "@repo/workspace/workspace/html-app-view";
import { useAgentConfirm } from "@repo/workspace/workspace/use-agent-confirm";
import { useAgentEditUndo } from "@repo/workspace/workspace/use-agent-edit-undo";
import { useDeepLinkNav } from "@repo/workspace/workspace/use-deep-link";
import { useOpenDailyNote } from "@repo/workspace/workspace/use-note-templates";
import { useOpenNote } from "@repo/editor/note/open-note-store";
import { VaultProvider } from "@repo/workspace/workspace/vault-context";
import { useAgentStore } from "@repo/workspace/stores/agent-store";
import { useDelegationStore } from "@repo/editor/stores/delegation-store";
import { useViewStore, type WorkspaceSurface } from "@repo/workspace/stores/view-store";
import { useVoiceStore } from "@repo/workspace/stores/voice-store";

// The graph and tasks views stay out of the main chunk: each (and the graph's
// d3-force dependency) loads on first open.
const GraphView = lazy(() => import("@repo/workspace/workspace/graph-view"));
const TasksView = lazy(() => import("@repo/workspace/workspace/tasks-view"));

/** The main surface: the graph, the tasks view, an HTML App (open `.html`
 * shown as an app), or the editor. Lives inside VaultProvider so it can read
 * `isHtmlApp`. */
function MainSurface({ surface }: { surface: WorkspaceSurface }) {
  const isHtmlApp = useOpenNote((s) => s.isHtmlApp);
  if (surface === "graph" || surface === "tasks") {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        }
      >
        {surface === "graph" ? <GraphView /> : <TasksView />}
      </Suspense>
    );
  }
  return isHtmlApp ? <HtmlAppView /> : <EditorPane />;
}

/** inteligir:// nav verbs (today / note / search). Lives inside VaultProvider
 * so it can open notes; search seeds the palette's box; renders nothing. */
function DeepLinkNav() {
  useDeepLinkNav(requestSearch);
  return null;
}

/** Post-turn undo toast for chat-agent vault edits. Lives inside
 * VaultProvider so flush-first can reach the registered open-note flush;
 * renders nothing. */
function AgentEditUndo() {
  useAgentEditUndo();
  return null;
}

/** The human answer to a destructive action the agent proposed. Renders
 * nothing — the shared confirm dialog is hosted at the app root. */
function AgentConfirm() {
  useAgentConfirm();
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

  // Recoverable agent errors route back here (setup errors surface on the
  // onboarding screen — see app-root.tsx).
  const appState = useAgentStore((s) => s.appState);
  const workspaceError =
    appState.phase === "error" && appState.prev === "ready" ? appState.message : null;

  // The dispatch rides the local WS and rejects if the socket is down. A
  // rejection means the transition never reached the host, so the banner and
  // this button stay put — pressing again IS the retry, and there is nothing
  // further to report.
  const handleRetry = useCallback(() => {
    void getBridge()
      .transition({ type: "RETRY" })
      .catch(() => {});
  }, []);

  return (
    <VaultProvider>
      <DailyNoteHotkey />
      <DeepLinkNav />
      <AgentEditUndo />
      <AgentConfirm />
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
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <PastChatsDialog />
    </VaultProvider>
  );
}
