// Built-in Extensions panel. Chief-of-Staff default shows the CLI integrations
// + skills list (the surfaces that are meaningful to a non-power-user); the
// developer surface (connector add/manage, raw secrets) lives behind a
// "Developer tools" toggle persisted in ui-state.

import { useState } from "react";

import { useDiskState } from "@/renderer/lib/use-disk-state";
import { ExecutorSections } from "@/renderer/shell/builtin/extensions/executor-sections";
import { IntegrationsSection } from "@/renderer/shell/builtin/integrations-section";
import { RemoteAccessSection } from "@/renderer/shell/builtin/extensions/remote-access-section";
import { SkillsSection } from "@/renderer/shell/builtin/extensions/skills-section";
import { useAgentStore } from "@/renderer/stores/agent-store";

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
      <IntegrationsSection />
      <SkillsSection />
      <RemoteAccessSection onError={setError} />
      {showDevTools && <ExecutorSections onError={setError} />}
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
