// Gate the executor-dependent connectors section on `executorStatus().running`.
// Until the daemon is up nothing it shows is meaningful, so render a
// placeholder + refresh button instead. (The v1 standalone secrets section is
// gone — credentials are connections now, managed through the connect flows.)
// `showAdvanced` flows through to the connectors section's developer-only
// surface (the custom add-connector escape hatch).

import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";

import { getBridge } from "@renderer/lib/bridge";
import { ConnectorsSection } from "@renderer/settings/extensions/connectors-section";
import type { SectionProps } from "@renderer/settings/extensions/lib";
import type { ExecutorStatus } from "@repo/features/ipc";

type ExecutorSectionsProps = SectionProps & { showAdvanced: boolean };

export function ExecutorSections({ onError, showAdvanced }: ExecutorSectionsProps) {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);

  const refreshStatus = useCallback(() => {
    void getBridge()
      ?.executorStatus()
      .then(setStatus)
      .catch(() => setStatus({ running: false }));
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  if (status === null) {
    return <div className="text-[10px] text-muted-foreground">Loading…</div>;
  }
  if (!status.running) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-[10px] bg-muted px-3 py-2 text-[10px] text-muted-foreground">
          Executor isn&apos;t running yet. Connectors and connections appear once it&apos;s ready.
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshStatus}
          className="h-7 self-start text-[10px]"
        >
          Refresh
        </Button>
      </div>
    );
  }
  return <ConnectorsSection onError={onError} showAdvanced={showAdvanced} />;
}
