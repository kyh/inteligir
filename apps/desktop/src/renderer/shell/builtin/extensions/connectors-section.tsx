import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import { AddCustomConnectorDialog } from "@/renderer/shell/builtin/extensions/add-custom-connector-dialog";
import {
  CONNECTOR_CATALOG,
  type CatalogConnector,
} from "@/renderer/shell/builtin/extensions/connector-catalog";
import { ConnectorCard } from "@/renderer/shell/builtin/extensions/connector-card";
import {
  errorMessage,
  normalizeUrl,
  runOAuthFlow,
  useBridgeResource,
  type SectionProps,
} from "@/renderer/shell/builtin/extensions/lib";
import { SecretPromptDialog } from "@/renderer/shell/builtin/extensions/secret-prompt-dialog";
import type { ExecutorSource } from "@/shared/executor";

/**
 * Does an installed executor source correspond to this catalog connector? Match
 * on identity we control at install time — the namespace (echoed as the source
 * id) or the endpoint URL — never the display name, which a custom source could
 * coincidentally share with a catalog entry.
 */
function sourceMatches(source: ExecutorSource, connector: CatalogConnector): boolean {
  return (
    source.id === connector.id ||
    (source.url != null && normalizeUrl(source.url) === normalizeUrl(connector.install.endpoint))
  );
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

  /** Register the MCP source for a connector once any auth step has succeeded. */
  const installMcpSource = useCallback(
    async (connector: CatalogConnector, headers?: Record<string, { secretId: string; prefix?: string }>) => {
      const bridge = getBridge();
      if (!bridge) return;
      await bridge.addMcpSource({
        transport: "remote",
        name: connector.name,
        endpoint: connector.install.endpoint,
        remoteTransport: "auto",
        namespace: connector.id,
        headers,
      });
      // Await the refresh so the card reads "connected" from updated sources
      // before the caller clears its busy flag — otherwise it flickers to
      // "Connect" for a frame.
      await refreshSources();
    },
    [refreshSources],
  );

  const handleConnect = useCallback(
    async (connector: CatalogConnector) => {
      const bridge = getBridge();
      if (!bridge) return;

      // API-key connectors need a secret before we can register the source.
      if (connector.install.auth.kind === "apiKey") {
        setApiKeyTarget(connector);
        return;
      }

      setMembership(setConnecting, connector.id, true);
      onError(null);
      try {
        if (connector.install.auth.kind === "oauth") {
          await runOAuthFlow(bridge, connector.install.endpoint, `mcp-oauth2-${connector.id}`);
          await refreshConnections();
        }
        await installMcpSource(connector);
      } catch (err) {
        onError(errorMessage(err, `Couldn't connect ${connector.name}.`));
      } finally {
        setMembership(setConnecting, connector.id, false);
      }
    },
    [onError, installMcpSource, refreshConnections],
  );

  const handleApiKeySubmit = useCallback(
    async (value: string) => {
      const connector = apiKeyTarget;
      const bridge = getBridge();
      if (!connector || !bridge) return;
      const auth = connector.install.auth;
      if (auth.kind !== "apiKey") return;
      setApiKeyBusy(true);
      onError(null);
      try {
        const secretId = `${connector.id}_key`;
        await bridge.setExecutorSecret({
          id: secretId,
          name: auth.secretLabel,
          value,
          provider: connector.id,
        });
        await installMcpSource(connector, {
          [auth.headerName]: { secretId, prefix: auth.prefix },
        });
        setApiKeyTarget(null);
      } catch (err) {
        onError(errorMessage(err, `Couldn't connect ${connector.name}.`));
      } finally {
        setApiKeyBusy(false);
      }
    },
    [apiKeyTarget, onError, installMcpSource],
  );

  const handleDisconnect = useCallback(
    async (connector: CatalogConnector) => {
      const bridge = getBridge();
      if (!bridge) return;
      setMembership(setDisconnecting, connector.id, true);
      onError(null);
      try {
        const source = (sources ?? []).find((s) => sourceMatches(s, connector));
        if (source) await bridge.removeExecutorSource(source.id);
        const connection = (connections ?? []).find(
          (c) => c.id === `mcp-oauth2-${connector.id}` || c.provider === connector.id,
        );
        if (connection) await bridge.removeExecutorConnection(connection.id);
        // Drop the secret created during the API-key connect flow so it doesn't
        // linger in the Secrets list after an explicit disconnect.
        if (connector.install.auth.kind === "apiKey") {
          await bridge.removeExecutorSecret(`${connector.id}_key`);
        }
      } catch (err) {
        onError(errorMessage(err, `Couldn't disconnect ${connector.name}.`));
      } finally {
        // Always reconcile with server state — a partial failure (e.g. the
        // source was removed but a later step threw) must not leave a stale
        // "Connected" card.
        await refreshSources();
        await refreshConnections();
        setMembership(setDisconnecting, connector.id, false);
      }
    },
    [onError, sources, connections, refreshSources, refreshConnections],
  );

  const handleRemoveCustom = useCallback(
    async (id: string) => {
      const bridge = getBridge();
      if (!bridge) return;
      try {
        await bridge.removeExecutorSource(id);
        // The custom dialog's OAuth option creates a connection keyed by the
        // source's namespace (mcp-oauth2-<id>); remove it too so it isn't left
        // orphaned and invisible.
        const connection = (connections ?? []).find(
          (c) => c.id === `mcp-oauth2-${id}` || c.provider === id,
        );
        if (connection) await bridge.removeExecutorConnection(connection.id);
      } catch (err) {
        onError(errorMessage(err, "Failed to remove connector."));
      } finally {
        await refreshSources();
        await refreshConnections();
      }
    },
    [onError, connections, refreshSources, refreshConnections],
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
    apiKeyTarget?.install.auth.kind === "apiKey" ? apiKeyTarget.install.auth.secretLabel : "";

  return (
    <div className="flex flex-col gap-2.5">
      <Label className="text-xs font-medium text-muted-foreground">Connectors</Label>

      <div className="grid grid-cols-2 gap-2">
        {CONNECTOR_CATALOG.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            status={statusFor(connector)}
            onConnect={() => void handleConnect(connector)}
            onDisconnect={() => void handleDisconnect(connector)}
          />
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
        onAdded={refreshSources}
        onError={onError}
      />
      <SecretPromptDialog
        connector={apiKeyTarget}
        label={apiKeyLabel}
        busy={apiKeyBusy}
        onCancel={() => setApiKeyTarget(null)}
        onSubmit={(v) => void handleApiKeySubmit(v)}
      />
    </div>
  );
}
