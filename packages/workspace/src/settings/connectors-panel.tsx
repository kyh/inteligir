// Built-in Extensions panel. Connectors lead — they're the only place to
// connect a server, so they're always visible and first. Skills follow. The
// developer surface (overriding the Google OAuth client) lives behind a
// "Developer tools" toggle persisted in ui-state.

import { useState } from "react";

import { useDiskState } from "@repo/workspace/lib/use-disk-state";
import { ConnectorStatusSection } from "@repo/workspace/settings/extensions/connector-status-section";
import { SkillsSection } from "@repo/workspace/settings/extensions/skills-section";
import { useAgentStore } from "@repo/workspace/stores/agent-store";

const DEVTOOLS_KEY = "extensions.showDevTools";

export function ConnectorsPanel() {
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
      <ConnectorStatusSection onError={setError} showAdvanced={showDevTools} />
      <SkillsSection />
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
