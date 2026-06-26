import { useCallback, useEffect } from "react";

import { Button } from "@repo/ui/components/button";

import { getBridge } from "@/renderer/lib/bridge";
import { ChatPanel } from "@/renderer/chat/chat-panel";
import { SettingsDialog } from "@/renderer/settings/settings-dialog";
import { VaultPanel } from "@/renderer/workspace/vault-panel";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

/**
 * The workspace — the app's only surface. A fixed three-region layout: the
 * vault (file tree + markdown editor) takes the page, with the chat thread
 * docked on the right. There is no widget grid; this is an AI-native notes
 * app, not an OS shell.
 */
export function WorkspacePage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  // The app machine routes recoverable error states (agent restart / logout)
  // back to this route; surface the message + a RETRY affordance here.
  const appState = useAgentStore((s) => s.appState);
  const workspaceError =
    appState.phase === "error" && (appState.prev === "ready" || appState.prev === "logging_out")
      ? appState.message
      : null;

  const handleRetry = useCallback(() => {
    getBridge()?.transition({ type: "RETRY" });
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Draggable title strip — the native title bar is hidden. Left padding
          clears the macOS traffic lights (hiddenInset, controls at x: 16). */}
      <div className="app-drag flex h-10 shrink-0 items-center justify-end gap-1 pr-3 pl-24">
        <SettingsDialog />
      </div>

      {workspaceError !== null && (
        <div className="absolute inset-x-0 top-12 z-30 flex justify-center px-20">
          <div className="glass-smoke-deep flex max-w-xl items-center gap-3 rounded-full px-3 py-1.5">
            <span className="truncate text-xs text-[#ffb4ab]" title={workspaceError}>
              {workspaceError}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="shrink-0 bg-glass-row text-glass-fg hover:bg-glass-row-hover hover:text-glass-fg"
              onClick={handleRetry}
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <VaultPanel />
        </div>
        <div className="w-[380px] shrink-0 border-l border-border">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
