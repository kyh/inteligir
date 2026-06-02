import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import { AddCustomConnectorDialog } from "@/renderer/shell/builtin/extensions/add-custom-connector-dialog";
import {
  CONNECTOR_CATALOG,
  CONNECTOR_GROUPS,
  type CatalogConnector,
} from "@/renderer/shell/builtin/extensions/connector-catalog";
import { ConnectorCard } from "@/renderer/shell/builtin/extensions/connector-card";
import {
  apiKeySecretId,
  catalogInstallRequest,
  installConnector,
  uninstallConnector,
} from "@/renderer/shell/builtin/extensions/connector-install";
import {
  errorMessage,
  useBridgeResource,
  type SectionProps,
} from "@/renderer/shell/builtin/extensions/lib";
import { SecretPromptDialog } from "@/renderer/shell/builtin/extensions/secret-prompt-dialog";
import type { ExecutorSource } from "@/shared/executor";

/**
 * Whether an installed executor source is this catalog connector. We register
 * every connector with `namespace: connector.id`, so we match on the namespace
 * the daemon reports — falling back to the source id, which older daemons set to
 * the namespace. Either way it's a single, unambiguous match (no name/URL guess).
 */
function sourceMatches(source: ExecutorSource, connector: CatalogConnector): boolean {
  return (source.namespace ?? source.id) === connector.id;
}

/** Add/remove an id from one of the in-flight (connecting/disconnecting) sets. */
function setMembership(
  setter: Dispatch<SetStateAction<ReadonlySet<string>>>,
  id: string,
  member: boolean,
): void {
  setter((prev) => {
    const next = new Set(prev);
    if (member) next.add(id);
    else next.delete(id);
    return next;
  });
}

export function ConnectorsSection({ onError }: SectionProps) {
  const { data: sources, refresh: refreshSources } = useBridgeResource(
    (b) => b.listExecutorSources(),
    onError,
  );
  const { data: connections, refresh: refreshConnections } = useBridgeResource(
    (b) => b.listExecutorConnections(),
    onError,
  );

  const [connecting, setConnecting] = useState<ReadonlySet<string>>(new Set());
  const [disconnecting, setDisconnecting] = useState<ReadonlySet<string>>(new Set());
  const [apiKeyTarget, setApiKeyTarget] = useState<CatalogConnector | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  // Shown inside the secret dialog — the panel-level error sits behind its overlay.
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const statusFor = useCallback(
    (connector: CatalogConnector) => {
      if (connecting.has(connector.id)) return "connecting" as const;
      if (disconnecting.has(connector.id)) return "disconnecting" as const;
      const installed = (sources ?? []).some((s) => sourceMatches(s, connector));
      return installed ? ("connected" as const) : ("idle" as const);
    },
    [connecting, disconnecting, sources],
  );

  // Sources and connections are independent; reconcile both at once. Awaited by
  // the handlers so a card reads its updated status before the busy flag clears
  // (otherwise it flickers between states for a frame).
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshSources(), refreshConnections()]);
  }, [refreshSources, refreshConnections]);

  const handleConnect = useCallback(
    async (connector: CatalogConnector) => {
      const bridge = getBridge();
      if (!bridge) return;

      // API-key connectors need a secret first; collect it via the dialog, which
      // calls handleApiKeySubmit once the user provides a value. Clear any stale
      // panel error now so it doesn't reappear behind/after the modal.
      if (connector.install.type === "mcp" && connector.install.auth.kind === "apiKey") {
        onError(null);
        setApiKeyError(null);
        setApiKeyTarget(connector);
        return;
      }

      setMembership(setConnecting, connector.id, true);
      onError(null);
      try {
        await installConnector(bridge, catalogInstallRequest(connector));
        await refreshAll();
      } catch (err) {
        onError(errorMessage(err, `Couldn't connect ${connector.name}.`));
      } finally {
        setMembership(setConnecting, connector.id, false);
      }
    },
    [onError, refreshAll],
  );

  const handleApiKeySubmit = useCallback(
    async (value: string) => {
      const connector = apiKeyTarget;
      const bridge = getBridge();
      if (!connector || !bridge) return;
      setApiKeyBusy(true);
      setApiKeyError(null);
      try {
        await installConnector(bridge, catalogInstallRequest(connector, value));
        await refreshAll();
        onError(null);
        setApiKeyTarget(null);
      } catch (err) {
        setApiKeyError(errorMessage(err, `Couldn't connect ${connector.name}.`));
      } finally {
        setApiKeyBusy(false);
      }
    },
    [apiKeyTarget, onError, refreshAll],
  );

  const handleDisconnect = useCallback(
    async (connector: CatalogConnector) => {
      const bridge = getBridge();
      if (!bridge) return;
      setMembership(setDisconnecting, connector.id, true);
      onError(null);
      try {
        const source = (sources ?? []).find((s) => sourceMatches(s, connector));
        const secretId =
          connector.install.type === "mcp" && connector.install.auth.kind === "apiKey"
            ? apiKeySecretId(connector.id)
            : undefined;
        await uninstallConnector(bridge, {
          sourceId: source?.id,
          namespace: connector.id,
          connections,
          secretId,
        });
      } catch (err) {
        onError(errorMessage(err, `Couldn't disconnect ${connector.name}.`));
      } finally {
        // Always reconcile with server state — a partial failure (e.g. the
        // source was removed but a later step threw) must not leave a stale
        // "Connected" card.
        await refreshAll();
        setMembership(setDisconnecting, connector.id, false);
      }
    },
    [onError, sources, connections, refreshAll],
  );

  const handleRemoveCustom = useCallback(
    async (id: string) => {
      const bridge = getBridge();
      if (!bridge) return;
      try {
        // A custom source's namespace is its id, so the same uninstall path also
        // cleans up any OAuth connection the custom dialog created.
        await uninstallConnector(bridge, { sourceId: id, namespace: id, connections });
      } catch (err) {
        onError(errorMessage(err, "Failed to remove connector."));
      } finally {
        await refreshAll();
      }
    },
    [onError, connections, refreshAll],
  );

  // Installed sources that aren't part of the catalog — surfaced so users can
  // see and remove anything added via the custom escape hatch (or the agent).
  const customSources = useMemo(() => {
    return (sources ?? []).filter((s) => {
      if (s.canRemove === false || s.runtime) return false;
      return !CONNECTOR_CATALOG.some((c) => sourceMatches(s, c));
    });
  }, [sources]);

  const apiKeyLabel =
    apiKeyTarget?.install.type === "mcp" && apiKeyTarget.install.auth.kind === "apiKey"
      ? apiKeyTarget.install.auth.secretLabel
      : "";

  return (
    <div className="flex flex-col gap-2.5">
      <Label className="text-xs font-medium text-muted-foreground">Connectors</Label>

      <div className="flex flex-col gap-3">
        {CONNECTOR_GROUPS.map(({ category, connectors }) => (
          <div key={category} className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {category}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {connectors.map((connector) => (
                <ConnectorCard
                  key={connector.id}
                  connector={connector}
                  status={statusFor(connector)}
                  onConnect={() => void handleConnect(connector)}
                  onDisconnect={() => void handleDisconnect(connector)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {customSources.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">Custom</span>
          {customSources.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground">
                  {s.name} <span className="text-muted-foreground">({s.kind})</span>
                </span>
                {s.url && (
                  <span className="truncate text-[10px] text-muted-foreground">{s.url}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRemoveCustom(s.id)}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground hover:text-destructive"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => setCustomOpen(true)}
        className="h-7 self-start text-[10px]"
      >
        <PlusIcon className="size-3" />
        Add custom connector
      </Button>

      <AddCustomConnectorDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        onAdded={refreshAll}
      />
      <SecretPromptDialog
        connector={apiKeyTarget}
        label={apiKeyLabel}
        busy={apiKeyBusy}
        error={apiKeyError}
        onCancel={() => setApiKeyTarget(null)}
        onSubmit={(v) => void handleApiKeySubmit(v)}
      />
    </div>
  );
}
