import { useCallback, useState } from "react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";

import { getBridge } from "@/renderer/lib/bridge";
import {
  blockDismissWhileBusy,
  errorMessage,
  oauthConnectionId,
  parseHeaders,
  runOAuthFlow,
  slug,
  type SectionProps,
} from "@/renderer/shell/builtin/extensions/lib";
import { isHttpUrl } from "@/shared/ipc";

type CustomKind = "mcp" | "openapi" | "graphql" | "google";
const KINDS: { id: CustomKind; label: string }[] = [
  { id: "mcp", label: "MCP" },
  { id: "openapi", label: "OpenAPI" },
  { id: "graphql", label: "GraphQL" },
  { id: "google", label: "Google" },
];

type Props = SectionProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void | Promise<void>;
};

export function AddCustomConnectorDialog({ open, onOpenChange, onAdded, onError }: Props) {
  const [kind, setKind] = useState<CustomKind>("mcp");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [oauth, setOauth] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setKind("mcp");
    setName("");
    setEndpoint("");
    setBaseUrl("");
    setHeadersText("");
    setOauth(false);
  }, []);

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
      const map: Record<string, CustomKind> = {
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
        if (oauth) {
          await runOAuthFlow(bridge, trimmedEndpoint, oauthConnectionId(ns));
        }
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
      reset();
      // Await the refresh so the new connector is in the list before the
      // dialog closes, rather than popping in a beat later.
      await onAdded();
      onOpenChange(false);
    } catch (err) {
      onError(errorMessage(err, "Failed to add connector."));
    } finally {
      setBusy(false);
    }
  }, [kind, name, endpoint, baseUrl, headersText, oauth, onError, onAdded, onOpenChange, reset]);

  return (
    <Dialog open={open} onOpenChange={blockDismissWhileBusy(busy, onOpenChange)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a custom connector</DialogTitle>
          <DialogDescription>
            Point at any MCP, OpenAPI, GraphQL, or Google Discovery endpoint.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                aria-pressed={kind === k.id}
                className={`rounded-md px-2 py-1.5 text-[11px] ${
                  kind === k.id
                    ? "bg-foreground/15 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/10"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="h-8 text-xs"
          />
          <div className="flex gap-1.5">
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
              className="h-8 flex-1 text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDetect()}
              className="h-8 px-2 text-[11px] text-muted-foreground"
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
              className="h-8 text-xs"
            />
          )}
          {(kind === "mcp" || kind === "openapi" || kind === "graphql") && (
            <Textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder={"Optional headers, one per line:\nAuthorization: Bearer ..."}
              className="min-h-[48px] text-xs"
              rows={2}
            />
          )}
          {kind === "mcp" && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={oauth}
                onChange={(e) => setOauth(e.target.checked)}
                className="size-3.5 accent-foreground"
              />
              Authenticate with OAuth before adding
            </label>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={busy}
            className="h-8 self-end px-4 text-[11px]"
          >
            {busy ? "Adding…" : "Add connector"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
