import { useCallback } from "react";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { AccountSection } from "@repo/workspace/settings/sections/account-section";
import { AiProviderSection } from "@repo/workspace/settings/sections/ai-provider-section";
import { AppearanceSection } from "@repo/workspace/settings/sections/appearance-section";
import { EditorAiSection } from "@repo/workspace/settings/sections/editor-ai-section";
import { NotesSection } from "@repo/workspace/settings/sections/notes-section";
import { RoutinesSection } from "@repo/workspace/settings/sections/routines-section";
import { SkillsSection } from "@repo/workspace/settings/sections/skills-section";
import { VoiceSection } from "@repo/workspace/settings/sections/voice-section";
import { useAgentStore } from "@repo/workspace/stores/agent-store";

/** The sections, in order. A hardcoded list on purpose (root CLAUDE.md
 * § Decisions) — a registry would buy indirection and an ordering problem in
 * exchange for a `.push()`. */
export function SettingsPanel() {
  const appState = useAgentStore((s) => s.appState);
  const newSession = useAgentStore((s) => s.newSession);
  const canStartNewSession = appState.phase === "ready" && appState.agent === "idle";

  const handleNewSession = useCallback(() => {
    void newSession();
  }, [newSession]);

  return (
    <div className="flex flex-col gap-6">
      <AppearanceSection />

      <AiProviderSection />

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Session</Label>
        <div className="flex items-center justify-between rounded-[10px] bg-muted px-3 py-2">
          <span className="flex flex-col">
            <span className="text-xs text-foreground">Start new session</span>
            <span className="text-[10px] text-muted-foreground">
              Starts a fresh thread. Past chats stay browsable.
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewSession}
            disabled={!canStartNewSession}
            className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            New session
          </Button>
        </div>
      </div>

      <NotesSection />

      <RoutinesSection />

      <SkillsSection />

      <AccountSection />

      <EditorAiSection />

      <VoiceSection />
    </div>
  );
}
