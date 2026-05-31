import { useCallback, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";

import { getBridge } from "@/renderer/lib/bridge";
import {
  errorMessage,
  parseHeaders,
  slug,
  useBridgeResource,
  type SectionProps,
} from "@/renderer/shell/builtin/extensions/lib";
import { isHttpUrl } from "@/shared/ipc";

type SourceKind = "mcp" | "openapi" | "graphql" | "google";
const SOURCE_KINDS: SourceKind[] = ["mcp", "openapi", "graphql", "google"];

export function SourcesSection({ onError }: SectionProps) {
  const { data: sources, refresh } = useBridgeResource((b) => b.listExecutorSources(), onError);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<SourceKind>("mcp");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headersText, setHeadersText] = useState("");

  const handleDetect = useCallback(async () => {
    const trimmed = endpoint.trim();
    if (!isHttpUrl(trimmed)) {
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
      onError(errorMessage(err, "Detection failed."));
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
    if (!isHttpUrl(trimmedEndpoint)) {
      onError("Enter a valid endpoint URL.");
      return;
    }
    if (kind === "openapi" && !isHttpUrl(trimmedBase)) {
      onError("OpenAPI sources need a valid Base URL (the API server, not the spec).");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const ns = slug(trimmedName);
      const headers = parseHeaders(headersText);
      if (kind === "mcp") {
        await bridge.addMcpSource({
          transport: "remote",
          name: trimmedName,
          endpoint: trimmedEndpoint,
          remoteTransport: "auto",
          namespace: ns,
          headers,
        });
      } else if (kind === "openapi") {
        await bridge.addOpenApiSource({
          spec: { kind: "url", url: trimmedEndpoint },
          name: trimmedName,
          baseUrl: trimmedBase,
          namespace: ns,
          headers,
        });
      } else if (kind === "graphql") {
        await bridge.addGraphqlSource({
          endpoint: trimmedEndpoint,
          name: trimmedName,
          namespace: ns,
          headers,
        });
      } else {
        await bridge.addGoogleSource({
          name: trimmedName,
          discoveryUrl: trimmedEndpoint,
          namespace: ns,
          auth: { kind: "none" },
        });
      }
      setName("");
      setEndpoint("");
      setBaseUrl("");
      setHeadersText("");
      refresh();
    } catch (err) {
      onError(errorMessage(err, "Failed to add source."));
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
        onError(errorMessage(err, "Failed to remove source."));
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
        onError(errorMessage(err, "Failed to refresh source."));
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
            <div
              key={s.id}
              className="flex items-start gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground">
                  {s.name} <span className="text-muted-foreground">({s.kind})</span>
                </span>
                {s.url && (
                  <span className="truncate text-[10px] text-muted-foreground">{s.url}</span>
                )}
              </div>
              {s.canRefresh !== false && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRefreshSource(s.id)}
                  className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  Refresh
                </Button>
              )}
              {s.canRemove !== false && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemove(s.id)}
                  className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                >
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
          {SOURCE_KINDS.map((k) => (
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
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="h-7 text-xs"
        />
        <div className="flex gap-1">
          <Input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={
              kind === "openapi"
                ? "OpenAPI spec URL"
                : kind === "google"
                  ? "Discovery doc URL"
                  : "Endpoint URL"
            }
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
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="API base URL (required)"
            className="h-7 text-xs"
          />
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleAdd()}
          disabled={busy}
          className="h-7 self-start px-3 text-[10px]"
        >
          {busy ? "Adding…" : "Add source"}
        </Button>
      </div>
    </div>
  );
}
