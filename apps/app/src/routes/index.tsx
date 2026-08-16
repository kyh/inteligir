import { useEffect, useState } from "react";
import { Badge } from "@repo/ui/components/badge";
import { Separator } from "@repo/ui/components/separator";
import { Spinner } from "@repo/ui/components/spinner";
import { createApiClient } from "@repo/server-contract/client";
import { serverMessageLenientSchema } from "@repo/server-contract/notifications";
import {
  systemStatusResponseSchema,
  type SystemStatusResponse,
} from "@repo/server-contract/routes";
import {
  vaultStatusResponseSchema,
  vaultTreeResponseSchema,
  type VaultStatusResponse,
  type VaultTreeResponse,
} from "@repo/server-contract/vault";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

type StatusState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; status: SystemStatusResponse };

type VaultState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; tree: VaultTreeResponse; status: VaultStatusResponse };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function syncBadge(status: VaultStatusResponse) {
  switch (status.state) {
    case "no-remote":
      return <Badge variant="outline">local only</Badge>;
    case "clean":
      return <Badge>synced</Badge>;
    case "dirty":
      return <Badge variant="secondary">unsynced changes</Badge>;
    case "syncing":
      return <Badge variant="secondary">syncing…</Badge>;
    case "conflict":
      return <Badge variant="destructive">conflict</Badge>;
  }
}

function Index() {
  const [state, setState] = useState<StatusState>({ phase: "loading" });
  const [vault, setVault] = useState<VaultState>({ phase: "loading" });

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
          setState({ phase: "error", message: errorMessage(error) });
        }
      }
    })();

    async function refreshVault() {
      try {
        const [treeResponse, statusResponse] = await Promise.all([
          client.vault.tree.$get(),
          client.vault.status.$get(),
        ]);
        if (!treeResponse.ok || !statusResponse.ok) {
          throw new Error(`vault ${treeResponse.status}/${statusResponse.status}`);
        }
        const tree = vaultTreeResponseSchema.parse(await treeResponse.json());
        const status = vaultStatusResponseSchema.parse(await statusResponse.json());
        if (!cancelled) {
          setVault({ phase: "ready", tree, status });
        }
      } catch (error) {
        if (!cancelled) {
          setVault({ phase: "error", message: errorMessage(error) });
        }
      }
    }
    void refreshVault();

    const socket = new WebSocket(`${window.location.origin.replace(/^http/u, "ws")}/ws`);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "subscribe", target: { kind: "vault" } }));
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const parsed = serverMessageLenientSchema.safeParse(JSON.parse(event.data));
      if (parsed.success && parsed.data.type === "changed" && parsed.data.entity === "vault") {
        void refreshVault();
      }
    });

    return () => {
      cancelled = true;
      socket.close();
    };
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4">
        <section className="space-y-4 rounded-lg border p-6">
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

        <section className="space-y-4 rounded-lg border p-6">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Vault</h2>
            {vault.phase === "ready" ? (
              syncBadge(vault.status)
            ) : vault.phase === "error" ? (
              <Badge variant="destructive">unavailable</Badge>
            ) : (
              <Spinner className="size-4" />
            )}
          </header>
          <Separator />
          {vault.phase === "ready" ? (
            <div className="space-y-3">
              <p
                className="truncate font-mono text-xs text-muted-foreground"
                title={vault.tree.root}
              >
                {vault.tree.root}
              </p>
              {vault.tree.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">The vault is empty.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                  {vault.tree.entries.map((entry) => (
                    <li
                      key={entry.path}
                      className="truncate font-mono"
                      style={{ paddingLeft: `${entry.path.split("/").length - 1}rem` }}
                      title={entry.path}
                    >
                      {entry.kind === "dir"
                        ? `${entry.path.split("/").at(-1)}/`
                        : entry.path.split("/").at(-1)}
                    </li>
                  ))}
                </ul>
              )}
              {vault.status.state === "conflict" ? (
                <p className="text-sm text-destructive">
                  Sync conflict in {vault.status.conflict.files.length} file
                  {vault.status.conflict.files.length === 1 ? "" : "s"}:{" "}
                  {vault.status.conflict.files.join(", ")}
                </p>
              ) : null}
              {vault.status.lastError !== null ? (
                <p className="text-sm text-muted-foreground">
                  Last sync error: {vault.status.lastError}
                </p>
              ) : null}
            </div>
          ) : vault.phase === "error" ? (
            <p className="text-sm text-muted-foreground">
              Could not load the vault: {vault.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading the vault…</p>
          )}
        </section>
      </div>
    </main>
  );
}
