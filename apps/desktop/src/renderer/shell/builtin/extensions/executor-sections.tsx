// Gate the three executor-dependent sections (sources/connections/secrets) on
// `executorStatus().running`. Until the daemon is up nothing they show is
// meaningful, so render a placeholder + refresh button instead.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";

import { getBridge } from "@/renderer/lib/bridge";
import { ConnectionsSection } from "@/renderer/shell/builtin/extensions/connections-section";
import { SecretsSection } from "@/renderer/shell/builtin/extensions/secrets-section";
import { SourcesSection } from "@/renderer/shell/builtin/extensions/sources-section";
import type { SectionProps } from "@/renderer/shell/builtin/extensions/lib";
import type { ExecutorStatus } from "@/shared/ipc";

export function ExecutorSections({ onError }: SectionProps) {
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
        <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
          Executor isn&apos;t running yet. Sources, connections, and secrets appear once it&apos;s
          ready.
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
  return (
    <>
      <SourcesSection onError={onError} />
      <ConnectionsSection onError={onError} />
      <SecretsSection onError={onError} />
    </>
  );
}
