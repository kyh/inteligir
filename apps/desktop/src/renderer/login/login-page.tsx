import { useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/components/button";

import { InitialOrb } from "@renderer/components/initial-orb";
import { getBridge } from "@renderer/lib/bridge";
import { useAgentStore } from "@renderer/stores/agent-store";
import type { AiProviderSettings } from "@repo/features/ai-provider";

export function LoginPage() {
  const appState = useAgentStore((s) => s.appState);

  const loggingIn = appState.phase === "logging_in";
  const loginError =
    appState.phase === "error" && appState.prev === "logging_in" ? appState.message : null;

  // Which AI provider the LOGIN transition will run OAuth against. Switching
  // here persists the selection (provider-config store) before the flow starts.
  const [settings, setSettings] = useState<AiProviderSettings | null>(null);

  useEffect(() => {
    void getBridge()
      .getAiProviderSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  const handleProviderChange = useCallback(async (provider: string) => {
    setSettings(await getBridge().setAiProviderConfig({ provider }));
  }, []);

  const handleLogin = useCallback(() => {
    getBridge().transition({ type: "LOGIN" });
  }, []);

  const handleRetry = useCallback(() => {
    getBridge().transition({ type: "RETRY" });
  }, []);

  const selectedLabel =
    settings?.providers.find((p) => p.id === settings.selected.provider)?.label ?? null;

  return (
    <div className="shell-dots flex flex-1 flex-col items-center justify-end px-6 pb-16">
      <InitialOrb />
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button
          onClick={loginError ? handleRetry : handleLogin}
          disabled={loggingIn}
          className="w-full text-xs"
        >
          {loginError
            ? "Retry"
            : loggingIn
              ? "Waiting..."
              : selectedLabel
                ? `Log in with ${selectedLabel}`
                : "Log in"}
        </Button>
        {settings && settings.providers.length > 1 && !loggingIn && (
          <select
            aria-label="AI provider"
            value={settings.selected.provider}
            onChange={(e) => void handleProviderChange(e.target.value)}
            className="h-7 w-full rounded-md bg-muted px-2 text-center text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground"
          >
            {settings.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
