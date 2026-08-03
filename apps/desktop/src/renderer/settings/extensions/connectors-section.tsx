import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import { AddCustomConnectorDialog } from "@renderer/settings/extensions/add-custom-connector-dialog";
import {
  catalogInstallRequest,
  CONNECTOR_CATALOG,
  CONNECTOR_GROUPS,
  type CatalogConnector,
} from "@renderer/settings/extensions/connector-catalog";
import { ConnectorCard } from "@renderer/settings/extensions/connector-card";
import { GoogleClientDialog } from "@renderer/settings/extensions/google-client-dialog";
import { useBridgeResource, type SectionProps } from "@renderer/settings/extensions/lib";
import { SecretPromptDialog } from "@renderer/settings/extensions/secret-prompt-dialog";
import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_OAUTH_CLIENT_SLUG,
  GOOGLE_TOKEN_URL,
  type ExecutorIntegration,
} from "@repo/bridge/executor";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

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

type ConnectorsSectionProps = SectionProps & {
  /**
   * Show the developer-only affordance — overriding the bundled Google OAuth
   * client with your own. Adding a server is NOT behind this: connecting an
   * arbitrary MCP server is the product, not an escape hatch.
   */
  showAdvanced: boolean;
};

export function ConnectorsSection({ onError, showAdvanced }: ConnectorsSectionProps) {
  const {
    data: integrations,
    error: integrationsError,
    refresh: refreshIntegrations,
  } = useBridgeResource((b) => b.listExecutorIntegrations(), onError);
  // Connections decide "connected": an integration with zero connections has
  // no usable credential (and no addressable tools), so it must render as
  // not-connected — installed-but-unauthenticated is exactly the lie the old
  // sources model told for Google.
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
  // Google OAuth-app registration dialog. Two ways in: a Google connect with
  // no registered client AND no bundled one (googleTarget set — submit also
  // continues the install), or the advanced "use your own client" override
  // (googleOverrideOpen — submit only registers/replaces the client).
  const [googleTarget, setGoogleTarget] = useState<CatalogConnector | null>(null);
  const [googleOverrideOpen, setGoogleOverrideOpen] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleRedirectUri, setGoogleRedirectUri] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const statusFor = useCallback(
    (connector: CatalogConnector) => {
      if (connecting.has(connector.id)) return "connecting" as const;
      if (disconnecting.has(connector.id)) return "disconnecting" as const;
      const installed = (integrations ?? []).some((i) => i.slug === connector.id);
      const credentialed = (connections ?? []).some((c) => c.integration === connector.id);
      // "Connected" only when a live connection (credential) exists — a bare
      // integration (e.g. consent never finished, or a migrated v1 orphan)
      // shows Connect so the user can finish the real auth flow.
      return installed && credentialed ? ("connected" as const) : ("idle" as const);
    },
    [connecting, disconnecting, integrations, connections],
  );

  const identityFor = useCallback(
    (connector: CatalogConnector) =>
      (connections ?? []).find((c) => c.integration === connector.id)?.identityLabel ?? null,
    [connections],
  );

  // Integrations and connections are independent; reconcile both at once.
  // Awaited by the handlers so a card reads its updated status before the busy
  // flag clears (otherwise it flickers between states for a frame).
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshIntegrations(), refreshConnections()]);
  }, [refreshIntegrations, refreshConnections]);

  const handleConnect = useCallback(
    async (connector: CatalogConnector) => {
      const bridge = getBridge();

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
        if (connector.install.type === "google") {
          // Google needs a registered OAuth client before consent can start.
          // Main reuses a registered "google" client as-is, or seeds the
          // build's bundled one (never overwriting) — only when neither
          // exists do we collect the user's GCP app via the dialog, which
          // calls handleGoogleClientSubmit to register it and continue.
          const ensured = await bridge.ensureGoogleOAuthClient();
          if (ensured.status === "unavailable") {
            const status = await bridge.executorStatus();
            setGoogleRedirectUri(status.running ? status.redirectUri : null);
            setGoogleError(null);
            setGoogleTarget(connector);
            return;
          }
        }
        await bridge.installConnector(catalogInstallRequest(connector));
        await refreshAll();
      } catch (err) {
        onError(toErrorMessage(err, `Couldn't connect ${connector.name}.`));
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
      if (!connector) return;
      setApiKeyBusy(true);
      setApiKeyError(null);
      try {
        await bridge.installConnector(catalogInstallRequest(connector, value));
        await refreshAll();
        onError(null);
        setApiKeyTarget(null);
      } catch (err) {
        setApiKeyError(toErrorMessage(err, `Couldn't connect ${connector.name}.`));
      } finally {
        setApiKeyBusy(false);
      }
    },
    [apiKeyTarget, onError, refreshAll],
  );

  const handleGoogleClientSubmit = useCallback(
    async (clientId: string, clientSecret: string) => {
      const connector = googleTarget;
      const bridge = getBridge();
      if (!connector) return;
      setGoogleBusy(true);
      setGoogleError(null);
      setMembership(setConnecting, connector.id, true);
      try {
        await bridge.createExecutorOAuthClient({
          owner: "user",
          slug: GOOGLE_OAUTH_CLIENT_SLUG,
          authorizationUrl: GOOGLE_AUTHORIZATION_URL,
          tokenUrl: GOOGLE_TOKEN_URL,
          grant: "authorization_code",
          clientId,
          clientSecret,
        });
        await bridge.installConnector(catalogInstallRequest(connector));
        await refreshAll();
        onError(null);
        setGoogleTarget(null);
      } catch (err) {
        setGoogleError(toErrorMessage(err, `Couldn't connect ${connector.name}.`));
      } finally {
        setGoogleBusy(false);
        setMembership(setConnecting, connector.id, false);
      }
    },
    [googleTarget, onError, refreshAll],
  );

  // Advanced override: register (or swap) the shared "google" OAuth client
  // without connecting anything — self-hosters/devs replacing the bundled
  // client with their own GCP app.
  const openGoogleOverride = useCallback(async () => {
    const bridge = getBridge();
    const status = await bridge.executorStatus();
    setGoogleRedirectUri(status.running ? status.redirectUri : null);
    setGoogleError(null);
    setGoogleOverrideOpen(true);
  }, []);

  const handleGoogleOverrideSubmit = useCallback(
    async (clientId: string, clientSecret: string) => {
      const bridge = getBridge();
      setGoogleBusy(true);
      setGoogleError(null);
      try {
        await bridge.createExecutorOAuthClient({
          owner: "user",
          slug: GOOGLE_OAUTH_CLIENT_SLUG,
          authorizationUrl: GOOGLE_AUTHORIZATION_URL,
          tokenUrl: GOOGLE_TOKEN_URL,
          grant: "authorization_code",
          clientId,
          clientSecret,
        });
        onError(null);
        setGoogleOverrideOpen(false);
      } catch (err) {
        setGoogleError(toErrorMessage(err, "Couldn't save the Google OAuth client."));
      } finally {
        setGoogleBusy(false);
      }
    },
    [onError],
  );

  const handleDisconnect = useCallback(
    async (connector: CatalogConnector) => {
      const bridge = getBridge();
      setMembership(setDisconnecting, connector.id, true);
      onError(null);
      try {
        await bridge.uninstallConnector({ slug: connector.id });
      } catch (err) {
        onError(toErrorMessage(err, `Couldn't disconnect ${connector.name}.`));
      } finally {
        // Always reconcile with server state — a partial failure (e.g. the
        // integration was removed but a later step threw) must not leave a
        // stale "Connected" card.
        await refreshAll();
        setMembership(setDisconnecting, connector.id, false);
      }
    },
    [onError, refreshAll],
  );

  const handleRemoveCustom = useCallback(
    async (integration: ExecutorIntegration) => {
      const bridge = getBridge();
      try {
        await bridge.uninstallConnector({ slug: integration.slug });
      } catch (err) {
        onError(toErrorMessage(err, "Failed to remove connector."));
      } finally {
        await refreshAll();
      }
    },
    [onError, refreshAll],
  );

  // Installed integrations that aren't part of the catalog — surfaced so users
  // can see and remove anything added via the custom escape hatch (or the agent).
  const customIntegrations = useMemo(() => {
    return (integrations ?? []).filter((i) => {
      if (!i.canRemove || i.kind === "built-in") return false;
      return !CONNECTOR_CATALOG.some((c) => c.id === i.slug);
    });
  }, [integrations]);

  const apiKeyLabel =
    apiKeyTarget?.install.type === "mcp" && apiKeyTarget.install.auth.kind === "apiKey"
      ? apiKeyTarget.install.auth.secretLabel
      : "";

  return (
    <div className="flex flex-col gap-2.5">
      <Label className="text-xs font-medium text-muted-foreground">Connectors</Label>

      {/* Wait for the first integrations+connections load before showing the
          grid — otherwise every card reads "idle" and a click could re-install
          an already-connected connector before we know its real state. */}
      {integrations === null || connections === null ? (
        integrationsError ? (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Couldn&apos;t load connectors.</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshAll()}
              className="h-auto px-2 py-0.5 text-[10px]"
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground">Loading…</div>
        )
      ) : (
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
                    identityLabel={identityFor(connector)}
                    canDisconnect={
                      integrations.find((i) => i.slug === connector.id)?.canRemove !== false
                    }
                    onConnect={() => void handleConnect(connector)}
                    onDisconnect={() => void handleDisconnect(connector)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {customIntegrations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">Custom</span>
          {customIntegrations.map((i) => (
            <div key={i.slug} className="flex items-center gap-2 rounded-[10px] bg-muted px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground">
                  {i.slug} <span className="text-muted-foreground">({i.kind})</span>
                </span>
                {i.displayUrl && (
                  <span className="truncate text-[10px] text-muted-foreground">{i.displayUrl}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRemoveCustom(i)}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground hover:text-destructive"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCustomOpen(true)}
          className="h-7 text-[10px]"
        >
          <PlusIcon className="size-3" />
          Add a server
        </Button>
        {showAdvanced && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openGoogleOverride()}
            className="h-7 text-[10px]"
          >
            Use your own Google OAuth client
          </Button>
        )}
      </div>

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
      <GoogleClientDialog
        open={googleTarget !== null || googleOverrideOpen}
        redirectUri={googleRedirectUri}
        busy={googleBusy}
        error={googleError}
        onCancel={() => {
          setGoogleTarget(null);
          setGoogleOverrideOpen(false);
        }}
        onSubmit={(id, secret) =>
          void (googleTarget
            ? handleGoogleClientSubmit(id, secret)
            : handleGoogleOverrideSubmit(id, secret))
        }
      />
    </div>
  );
}
