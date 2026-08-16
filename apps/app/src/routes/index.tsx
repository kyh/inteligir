import { useEffect, useState } from "react";
import { Badge } from "@repo/ui/components/badge";
import { Separator } from "@repo/ui/components/separator";
import { Spinner } from "@repo/ui/components/spinner";
import { createApiClient } from "@repo/server-contract/client";
import {
  systemStatusResponseSchema,
  type SystemStatusResponse,
} from "@repo/server-contract/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

type StatusState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; status: SystemStatusResponse };

function Index() {
  const [state, setState] = useState<StatusState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    const client = createApiClient(window.location.origin);
    void (async () => {
      try {
        const response = await client.system.status.$get();
        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }
        const status = systemStatusResponseSchema.parse(await response.json());
        if (!cancelled) {
          setState({ phase: "ready", status });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setState({ phase: "error", message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <section className="w-full max-w-md space-y-4 rounded-lg border p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">inteligir</h1>
          {state.phase === "ready" ? (
            <Badge>online</Badge>
          ) : state.phase === "error" ? (
            <Badge variant="destructive">offline</Badge>
          ) : (
            <Spinner className="size-4" />
          )}
        </header>
        <Separator />
        {state.phase === "ready" ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="text-right font-mono">{state.status.version}</dd>
            <dt className="text-muted-foreground">Data dir</dt>
            <dd className="truncate text-right font-mono" title={state.status.dataDir}>
              {state.status.dataDir}
            </dd>
            <dt className="text-muted-foreground">Schema</dt>
            <dd className="text-right font-mono">v{state.status.schemaVersion}</dd>
            <dt className="text-muted-foreground">Uptime</dt>
            <dd className="text-right font-mono">{Math.round(state.status.uptimeMs / 1000)}s</dd>
          </dl>
        ) : state.phase === "error" ? (
          <p className="text-sm text-muted-foreground">
            Could not reach the local server: {state.message}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Checking the local server…</p>
        )}
      </section>
    </main>
  );
}
