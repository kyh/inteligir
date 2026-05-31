// Built-in Extensions panel. Composes the four sub-sections defined in
// builtin/extensions/. Renders nothing real until the agent is ready (skills
// + executor-backed sections both need pi running to produce useful results).

import { useState } from "react";

import { ExecutorSections } from "@/renderer/shell/builtin/extensions/executor-sections";
import { SkillsSection } from "@/renderer/shell/builtin/extensions/skills-section";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function ExtensionsPanel() {
  const appState = useAgentStore((s) => s.appState);
  const [error, setError] = useState<string | null>(null);

  if (appState.phase !== "ready") {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Extensions will appear once the agent is ready.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {error && <div className="text-[10px] text-destructive">{error}</div>}
      <ExecutorSections onError={setError} />
      <SkillsSection />
    </div>
  );
}
