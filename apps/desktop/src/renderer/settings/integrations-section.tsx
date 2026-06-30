import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import type { IntegrationInfo, SetupProgress } from "@/shared/ipc";

/**
 * Lists the installed CLI binaries (agent-browser, peekaboo, executor)
 * with their installed-vs-pinned versions, and a Repair button that
 * force-reinstalls them — useful when a download was skipped (offline
 * onboarding) or a binary got wedged. Binaries normally upgrade automatically
 * when the app updates; this is the manual escape hatch.
 */
export function IntegrationsSection() {
  const [integrations, setIntegrations] = useState<IntegrationInfo[] | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [progress, setProgress] = useState<SetupProgress | null>(null);

  const refresh = useCallback(() => {
    void getBridge()
      ?.listIntegrations()
      .then(setIntegrations)
      .catch(() => setIntegrations([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While repairing, mirror the onboarding progress stream.
  useEffect(() => {
    if (!repairing) return;
    return getBridge()?.onSetupProgress(setProgress);
  }, [repairing]);

  const handleRepair = useCallback(async () => {
    setRepairing(true);
    setProgress(null);
    try {
      await getBridge()?.repairIntegrations();
      refresh();
    } finally {
      setRepairing(false);
      setProgress(null);
    }
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Integrations</Label>
      <p className="text-[10px] text-muted-foreground">
        Bundled CLI tools. They update automatically when the app updates; reinstall to repair a
        missing or corrupt binary.
      </p>

      {integrations === null ? (
        <div className="text-[10px] text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {integrations.map((it) => {
            const upToDate = it.installed === it.expected;
            const label = it.installed
              ? upToDate
                ? it.installed
                : `${it.installed} → ${it.expected}`
              : "not installed";
            return (
              <div
                key={it.name}
                className="flex items-center justify-between rounded-[10px] bg-muted px-3 py-2"
              >
                <span className="text-xs text-foreground">{it.name}</span>
                <span
                  className={
                    upToDate ? "text-[10px] text-muted-foreground" : "text-[10px] text-foreground"
                  }
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => void handleRepair()}
          disabled={repairing}
          className="h-7 px-3 text-[10px]"
        >
          {repairing ? "Reinstalling…" : "Reinstall all"}
        </Button>
        {repairing && progress && (
          <span className="truncate text-[10px] text-muted-foreground">
            {progress.step}
            {progress.percent !== null ? ` (${progress.percent}%)` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
