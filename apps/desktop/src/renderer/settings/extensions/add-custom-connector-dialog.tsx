import { useCallback, useEffect, useState } from "react";

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

import { SegmentedControl } from "@renderer/components/segmented-control";
import { getBridge } from "@renderer/lib/bridge";
import { blockDismissWhileBusy, parseHeaders, slug } from "@renderer/settings/extensions/lib";
import type { ConnectorSourceSpec } from "@repo/bridge/executor";
import { isHttpUrl, toErrorMessage } from "@repo/bridge/wire-helpers";

type CustomKind = "mcp" | "openapi" | "graphql" | "google";
const KINDS: { id: CustomKind; label: string }[] = [
  { id: "mcp", label: "MCP" },
  { id: "openapi", label: "OpenAPI" },
  { id: "graphql", label: "GraphQL" },
  { id: "google", label: "Google" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void | Promise<void>;
};

export function AddCustomConnectorDialog({ open, onOpenChange, onAdded }: Props) {
  const [kind, setKind] = useState<CustomKind>("mcp");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [oauth, setOauth] = useState(false);
  const [busy, setBusy] = useState(false);
  // Errors render inside the dialog — routing them to the panel behind the
  // modal overlay would hide them from the user.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

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
      setError("Enter a valid URL to detect.");
      return;
    }
    setError(null);
    try {
      const results = await getBridge().detectExecutorIntegration(trimmed);
      const best = results[0];
      if (!best) {
        setError("Couldn't detect a connector type for that URL.");
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
      setError(toErrorMessage(err, "Detection failed."));
    }
  }, [endpoint, name]);

  const handleAdd = useCallback(async () => {
    const bridge = getBridge();
    const trimmedName = name.trim();
    const trimmedEndpoint = endpoint.trim();
    const trimmedBase = baseUrl.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (!isHttpUrl(trimmedEndpoint)) {
      setError("Enter a valid endpoint URL.");
      return;
    }
    if (kind === "openapi" && !isHttpUrl(trimmedBase)) {
      setError("OpenAPI sources need a valid Base URL (the API server, not the spec).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Prefix so custom slugs can't collide with a catalog connector's id,
      // and add a random suffix so two custom connectors that slug to the same
      // name still get distinct integrations.
      const customSlug = `custom_${slug(trimmedName)}_${crypto.randomUUID().slice(0, 8)}`;
      const source: ConnectorSourceSpec =
        kind === "openapi"
          ? {
              type: "openapi",
              name: trimmedName,
              slug: customSlug,
              specUrl: trimmedEndpoint,
              baseUrl: trimmedBase,
            }
          : kind === "graphql"
            ? { type: "graphql", name: trimmedName, slug: customSlug, endpoint: trimmedEndpoint }
            : kind === "google"
              ? {
                  type: "google",
                  name: trimmedName,
                  slug: customSlug,
                  discoveryUrl: trimmedEndpoint,
                }
              : { type: "mcp", name: trimmedName, slug: customSlug, endpoint: trimmedEndpoint };
      // Google discovery integrations always authenticate through the shared
      // "google" OAuth client (register it by connecting any catalog Google
      // connector first); everything else is OAuth-by-choice or open.
      const headers = parseHeaders(headersText);
      await bridge.installConnector({
        source,
        auth:
          kind === "google"
            ? { kind: "google" }
            : kind === "mcp" && oauth
              ? { kind: "oauth" }
              : { kind: "none" },
        ...(headers === undefined ? {} : { headers }),
      });
      reset();
      // Await the refresh so the new connector is in the list before the
      // dialog closes, rather than popping in a beat later.
      await onAdded();
      onOpenChange(false);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to add connector."));
    } finally {
      setBusy(false);
    }
  }, [kind, name, endpoint, baseUrl, headersText, oauth, onAdded, onOpenChange, reset]);

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
          <SegmentedControl
            options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
            value={kind}
            onChange={setKind}
            className="grid-cols-4"
            optionClassName="text-[11px]"
          />
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
              className="h-8 px-2 text-[11px]"
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
                className="size-3.5 accent-primary"
              />
              Authenticate with OAuth before adding
            </label>
          )}
          {error && <div className="text-[10px] text-destructive">{error}</div>}
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
