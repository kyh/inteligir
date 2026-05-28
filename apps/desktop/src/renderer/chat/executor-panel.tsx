import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";

import { getBridge } from "@/renderer/lib/bridge";
import type { ExecutorStatus } from "@/shared/ipc";
import type {
  ExecutorConnectionRef,
  ExecutorExecuteResult,
  ExecutorSecretRef,
  ExecutorSource,
  ExecutorToolMeta,
} from "@/shared/executor";

type SourceKind = "mcp" | "openapi" | "graphql" | "google";

const OAUTH_POLL_MS = 1500;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

function parseHeaders(raw: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (key) headers[key] = trimmed.slice(idx + 1).trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "source";
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function ExecutorPanel() {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    return <div className="p-3 text-[10px] text-muted-foreground">Loading…</div>;
  }
  if (!status.running) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
          Executor isn&apos;t running yet. It starts with the agent; integrations appear once
          it&apos;s ready.
        </div>
        <Button variant="outline" size="sm" onClick={refreshStatus} className="h-7 self-start text-[10px]">
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {error && <div className="text-[10px] text-destructive">{error}</div>}
      <SourcesSection onError={setError} />
      <ConnectionsSection onError={setError} />
      <SecretsSection onError={setError} />
      <ToolsSection onError={setError} />
      <CodeConsole onError={setError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function SourcesSection({ onError }: { onError: (e: string | null) => void }) {
  const [sources, setSources] = useState<ExecutorSource[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<SourceKind>("mcp");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headersText, setHeadersText] = useState("");

  const refresh = useCallback(() => {
    void getBridge()
      ?.listExecutorSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDetect = useCallback(async () => {
    const trimmed = endpoint.trim();
    if (!isValidUrl(trimmed)) {
      onError("Enter a valid URL to detect.");
      return;
    }
    onError(null);
    try {
      const results = await getBridge()?.detectExecutorSource(trimmed);
      const best = results?.[0];
      if (!best) {
        onError("Couldn't detect a source type for that URL.");
        return;
      }
      const map: Record<string, SourceKind> = {
        mcp: "mcp",
        openapi: "openapi",
        graphql: "graphql",
        googleDiscovery: "google",
      };
      setKind(map[best.kind] ?? "mcp");
      if (!name.trim()) setName(best.name);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Detection failed.");
    }
  }, [endpoint, name, onError]);

  const handleAdd = useCallback(async () => {
    const bridge = getBridge();
    const trimmedName = name.trim();
    const trimmedEndpoint = endpoint.trim();
    const trimmedBase = baseUrl.trim();
    if (!bridge || !trimmedName) {
      onError("Name is required.");
      return;
    }
    if (!isValidUrl(trimmedEndpoint)) {
      onError("Enter a valid endpoint URL.");
      return;
    }
    if (kind === "openapi" && !isValidUrl(trimmedBase)) {
      onError("OpenAPI sources need a valid Base URL (the API server, not the spec).");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const ns = slug(trimmedName);
      const headers = parseHeaders(headersText);
      if (kind === "mcp") {
        await bridge.addMcpSource({ transport: "remote", name: trimmedName, endpoint: trimmedEndpoint, remoteTransport: "auto", namespace: ns, headers });
      } else if (kind === "openapi") {
        await bridge.addOpenApiSource({ spec: { kind: "url", url: trimmedEndpoint }, name: trimmedName, baseUrl: trimmedBase, namespace: ns, headers });
      } else if (kind === "graphql") {
        await bridge.addGraphqlSource({ endpoint: trimmedEndpoint, name: trimmedName, namespace: ns, headers });
      } else {
        await bridge.addGoogleSource({ name: trimmedName, discoveryUrl: trimmedEndpoint, namespace: ns, auth: { kind: "none" } });
      }
      setName("");
      setEndpoint("");
      setBaseUrl("");
      setHeadersText("");
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add source.");
    } finally {
      setBusy(false);
    }
  }, [kind, name, endpoint, baseUrl, headersText, onError, refresh]);

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await getBridge()?.removeExecutorSource(id);
        refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to remove source.");
      }
    },
    [onError, refresh],
  );

  const handleRefreshSource = useCallback(
    async (id: string) => {
      try {
        await getBridge()?.refreshExecutorSource(id);
        refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to refresh source.");
      }
    },
    [onError, refresh],
  );

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Sources</Label>
      {sources === null ? (
        <div className="text-[10px] text-muted-foreground">Loading…</div>
      ) : sources.length === 0 ? (
        <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
          No sources configured.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sources.map((s) => (
            <div key={s.id} className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground">
                  {s.name} <span className="text-muted-foreground">({s.kind})</span>
                </span>
                {s.url && <span className="truncate text-[10px] text-muted-foreground">{s.url}</span>}
              </div>
              {s.canRefresh !== false && (
                <Button variant="ghost" size="sm" onClick={() => void handleRefreshSource(s.id)} className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground">
                  Refresh
                </Button>
              )}
              {s.canRemove !== false && (
                <Button variant="ghost" size="sm" onClick={() => void handleRemove(s.id)} className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground">
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
        <span className="text-[10px] font-medium text-muted-foreground">Add source</span>
        <div className="grid grid-cols-4 gap-1">
          {(["mcp", "openapi", "graphql", "google"] as SourceKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`rounded-sm px-2 py-1 text-[10px] ${kind === k ? "bg-foreground/15 text-foreground" : "text-muted-foreground hover:bg-foreground/10"}`}
            >
              {k}
            </button>
          ))}
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-7 text-xs" />
        <div className="flex gap-1">
          <Input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={kind === "openapi" ? "OpenAPI spec URL" : kind === "google" ? "Discovery doc URL" : "Endpoint URL"}
            className="h-7 flex-1 text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDetect()}
            className="h-7 px-2 text-[10px] text-muted-foreground"
            title="Detect the source type from the URL"
          >
            Detect
          </Button>
        </div>
        {kind === "openapi" && (
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="API base URL (required)" className="h-7 text-xs" />
        )}
        {(kind === "mcp" || kind === "openapi" || kind === "graphql") && (
          <Textarea
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            placeholder={"Optional headers, one per line:\nAuthorization: Bearer ..."}
            className="min-h-[40px] text-xs"
            rows={2}
          />
        )}
        <Button variant="outline" size="sm" onClick={() => void handleAdd()} disabled={busy} className="h-7 self-start px-3 text-[10px]">
          {busy ? "Adding…" : "Add source"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connections (OAuth)
// ---------------------------------------------------------------------------

function ConnectionsSection({ onError }: { onError: (e: string | null) => void }) {
  const [connections, setConnections] = useState<ExecutorConnectionRef[] | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void getBridge()
      ?.listExecutorConnections()
      .then(setConnections)
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge || !endpoint.trim()) {
      onError("Enter the OAuth-protected endpoint URL.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const start = await bridge.executorOAuthStart({
        endpoint: endpoint.trim(),
        pluginId: "mcp",
        connectionId: `mcp-oauth2-${slug(endpoint)}`,
      });
      if (start.completedConnection) {
        refresh();
        return;
      }
      if (!start.authorizationUrl) {
        onError("No authorization URL returned.");
        return;
      }
      await bridge.executorOpenExternal(start.authorizationUrl);
      // Poll the one-shot await endpoint until the browser callback completes.
      const deadline = Date.now() + OAUTH_TIMEOUT_MS;
      for (;;) {
        if (Date.now() > deadline) {
          onError("OAuth timed out.");
          refresh(); // in case the connection completed but the result poll was missed
          return;
        }
        await new Promise((r) => setTimeout(r, OAUTH_POLL_MS));
        const result = await bridge.executorOAuthAwait(start.sessionId);
        if (!result) continue;
        if (result.ok) {
          setEndpoint("");
          refresh();
        } else {
          onError(`OAuth failed: ${result.error}`);
        }
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "OAuth failed.");
    } finally {
      setBusy(false);
    }
  }, [endpoint, onError, refresh]);

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await getBridge()?.removeExecutorConnection(id);
        refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to remove connection.");
      }
    },
    [onError, refresh],
  );

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Connections (OAuth)</Label>
      {connections && connections.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {connections.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground">{c.identityLabel ?? c.provider}</span>
                <span className="truncate text-[10px] text-muted-foreground">{c.provider}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void handleRemove(c.id)} className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground">
                Disconnect
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
        <span className="text-[10px] font-medium text-muted-foreground">Connect a provider</span>
        <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="OAuth-protected endpoint URL" className="h-7 text-xs" />
        <Button variant="outline" size="sm" onClick={() => void handleConnect()} disabled={busy} className="h-7 self-start px-3 text-[10px]">
          {busy ? "Waiting for browser…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

function SecretsSection({ onError }: { onError: (e: string | null) => void }) {
  const [secrets, setSecrets] = useState<ExecutorSecretRef[] | null>(null);
  const [id, setId] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void getBridge()
      ?.listExecutorSecrets()
      .then(setSecrets)
      .catch(() => setSecrets([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    if (!id.trim() || !value.trim()) {
      onError("Secret id and value are required.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await getBridge()?.setExecutorSecret({ id: id.trim(), name: id.trim(), value: value.trim() });
      setId("");
      setValue("");
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save secret.");
    } finally {
      setBusy(false);
    }
  }, [id, value, onError, refresh]);

  const handleRemove = useCallback(
    async (secretId: string) => {
      try {
        await getBridge()?.removeExecutorSecret(secretId);
        refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to remove secret.");
      }
    },
    [onError, refresh],
  );

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Secrets</Label>
      {secrets && secrets.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{s.name}</span>
              <Button variant="ghost" size="sm" onClick={() => void handleRemove(s.id)} className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground">
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
        <span className="text-[10px] font-medium text-muted-foreground">Add secret</span>
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="Secret id (e.g. github-token)" className="h-7 text-xs" />
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" type="password" className="h-7 text-xs" />
        <Button variant="outline" size="sm" onClick={() => void handleAdd()} disabled={busy} className="h-7 self-start px-3 text-[10px]">
          {busy ? "Saving…" : "Save secret"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools browser (read-only view of the catalog the agent can reach)
// ---------------------------------------------------------------------------

function ToolsSection({ onError }: { onError: (e: string | null) => void }) {
  const [tools, setTools] = useState<ExecutorToolMeta[] | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    void getBridge()
      ?.listExecutorTools()
      .then(setTools)
      .catch((err: unknown) => onError(err instanceof Error ? err.message : "Failed to list tools."));
  }, [onError]);

  useEffect(() => {
    if (open && tools === null) refresh();
  }, [open, tools, refresh]);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-left"
      >
        <Label className="cursor-pointer text-xs font-medium text-muted-foreground">
          Tools {tools ? `(${tools.length})` : ""}
        </Label>
        <span className="text-[10px] text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open &&
        (tools === null ? (
          <div className="text-[10px] text-muted-foreground">Loading…</div>
        ) : tools.length === 0 ? (
          <div className="text-[10px] text-muted-foreground">No tools available.</div>
        ) : (
          <div className="flex max-h-48 flex-col gap-1 overflow-auto">
            {tools.map((t) => (
              <div key={t.id} className="rounded-md border border-border px-3 py-1.5" title={t.description}>
                <span className="text-xs text-foreground">{t.name}</span>
                {t.description && (
                  <p className="line-clamp-2 text-[10px] text-muted-foreground">{t.description}</p>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code console (run code mode directly)
// ---------------------------------------------------------------------------

function CodeConsole({ onError }: { onError: (e: string | null) => void }) {
  const [code, setCode] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleRun = useCallback(async () => {
    if (!code.trim()) return;
    setBusy(true);
    onError(null);
    setOutput(null);
    try {
      const result: ExecutorExecuteResult | undefined = await getBridge()?.executorExecute(code);
      setOutput(result?.text ?? "(no output)");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Execution failed.");
    } finally {
      setBusy(false);
    }
  }, [code, onError]);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Code console</Label>
      <Textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={'const { items } = await tools.search({ query: "github issues" });\nreturn items.map((i) => i.path);'}
        className="min-h-[80px] font-mono text-xs"
        rows={4}
      />
      <Button variant="outline" size="sm" onClick={() => void handleRun()} disabled={busy} className="h-7 self-start px-3 text-[10px]">
        {busy ? "Running…" : "Run"}
      </Button>
      {output !== null && (
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-[10px] text-foreground whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}
