// Built-in Extensions panel. Connectors lead — they're the only place to
// connect Google etc., so they're always visible and first. Skills follow. The
// developer surface (custom add-connector escape hatch, bundled CLI binaries)
// lives behind a "Developer tools" toggle persisted in ui-state.

import { useState } from "react";

import { useDiskState } from "@repo/app/lib/use-disk-state";
import { ExecutorSections } from "@repo/app/settings/extensions/executor-sections";
import { IntegrationsSection } from "@repo/app/settings/integrations-section";
import { SkillsSection } from "@repo/app/settings/extensions/skills-section";
import { useAgentStore } from "@repo/app/stores/agent-store";

const DEVTOOLS_KEY = "extensions.showDevTools";

export function ExtensionsPanel() {
  const appState = useAgentStore((s) => s.appState);
  const [error, setError] = useState<string | null>(null);
  const [showDevTools, setShowDevTools] = useDiskState<boolean>(DEVTOOLS_KEY, false, (v) =>
    typeof v === "boolean" ? v : undefined,
  );

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
      <ExecutorSections onError={setError} showAdvanced={showDevTools} />
      <SkillsSection />
      {showDevTools && <IntegrationsSection />}
      <button
        type="button"
        onClick={() => setShowDevTools(!showDevTools)}
        className="self-start text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        {showDevTools ? "Hide developer tools" : "Developer tools (advanced)"}
      </button>
    </div>
  );
}
