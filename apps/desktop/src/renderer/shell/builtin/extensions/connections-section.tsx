import { useCallback, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import {
  errorMessage,
  slug,
  useBridgeResource,
  type SectionProps,
} from "@/renderer/shell/builtin/extensions/lib";

const OAUTH_POLL_MS = 1500;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

export function ConnectionsSection({ onError }: SectionProps) {
  const { data: connections, refresh } = useBridgeResource(
    (b) => b.listExecutorConnections(),
    onError,
  );
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);

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
      const deadline = Date.now() + OAUTH_TIMEOUT_MS;
      for (;;) {
        if (Date.now() > deadline) {
          onError("OAuth timed out.");
          refresh();
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
      onError(errorMessage(err, "OAuth failed."));
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
        onError(errorMessage(err, "Failed to remove connection."));
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
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground">
                  {c.identityLabel ?? c.provider}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">{c.provider}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRemove(c.id)}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                Disconnect
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
        <span className="text-[10px] font-medium text-muted-foreground">Connect a provider</span>
        <Input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="OAuth-protected endpoint URL"
          className="h-7 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleConnect()}
          disabled={busy}
          className="h-7 self-start px-3 text-[10px]"
        >
          {busy ? "Waiting for browser…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
