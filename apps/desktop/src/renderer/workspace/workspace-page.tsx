import { useCallback, useEffect } from "react";

import { Button } from "@repo/ui/components/button";
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar";

import { getBridge } from "@/renderer/lib/bridge";
import { BottomComposer } from "@/renderer/composer/bottom-composer";
import { EditorPane } from "@/renderer/editor/editor-pane";
import { Header } from "@/renderer/layout/header";
import { AppSidebar } from "@/renderer/sidebar/app-sidebar";
import { VaultProvider } from "@/renderer/workspace/vault-context";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useDelegationStore } from "@/renderer/stores/delegation-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

/**
 * The workspace — the app's only surface. A Notion-style shell: a collapsible
 * file-tree sidebar and a full-width editor with the AI composer pinned at the
 * bottom. No chat column. Cmd+B toggles the sidebar; Cmd+K focuses the composer.
 */
export function WorkspacePage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  const initDelegations = useDelegationStore((s) => s.init);
  useEffect(() => initDelegations(), [initDelegations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.focus();
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
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Header />

          {workspaceError !== null && (
            <div className="absolute inset-x-0 top-14 z-30 flex justify-center px-8">
              <div className="flex max-w-xl items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5">
                <span className="truncate text-xs text-destructive" title={workspaceError}>
                  {workspaceError}
                </span>
                <Button size="xs" variant="outline" className="shrink-0" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <EditorPane />
            </div>
            <BottomComposer />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </VaultProvider>
  );
}
