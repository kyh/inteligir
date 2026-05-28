import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";

import { getBridge } from "@/renderer/lib/bridge";
import { AddMcpServerParamsSchema, type McpServer } from "@/shared/mcp";

/**
 * Parse a textarea of `Key: Value` lines into a headers record. Blank lines and
 * lines without a colon are ignored. Returns undefined when nothing parses so
 * we don't persist an empty headers object.
 */
function parseHeaders(raw: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function McpServersSection() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    const promise = getBridge()?.listMcpServers();
    if (!promise) return;
    void promise.then((list) => setServers(list.servers)).catch(() => setServers([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    // Validate with the same schema the IPC handler enforces, so field rules
    // and messages stay in one place.
    const parsed = AddMcpServerParamsSchema.safeParse({
      name: name.trim(),
      url: url.trim(),
      headers: parseHeaders(headersText),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const list = await getBridge()?.addMcpServer(parsed.data);
      if (list) setServers(list.servers);
      setName("");
      setUrl("");
      setHeadersText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server.");
    } finally {
      setBusy(false);
    }
  }, [name, url, headersText]);

  const handleRemove = useCallback(async (serverName: string) => {
    setBusy(true);
    setError(null);
    try {
      const list = await getBridge()?.removeMcpServer(serverName);
      if (list) setServers(list.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove server.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleToggle = useCallback(async (serverName: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const list = await getBridge()?.setMcpServerEnabled({ name: serverName, enabled });
      if (list) setServers(list.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update server.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">MCP Connectors</Label>
      <p className="text-[10px] text-muted-foreground">
        Connect remote (HTTP/SSE) Model Context Protocol servers. They&apos;re registered with the
        bundled executor runtime, so the agent can reach their tools from code mode.
      </p>

      {servers === null ? (
        <div className="text-[10px] text-muted-foreground">Loading…</div>
      ) : servers.length === 0 ? (
        <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
          No MCP servers configured.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {servers.map((server) => (
            <div
              key={server.name}
              className="flex items-start gap-2 rounded-md border border-border px-3 py-2"
            >
              <Checkbox
                checked={server.enabled}
                disabled={busy}
                onCheckedChange={(checked) => {
                  void handleToggle(server.name, checked === true);
                }}
                className="mt-0.5"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground">{server.name}</span>
                <span className="truncate text-[10px] text-muted-foreground">{server.url}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void handleRemove(server.name)}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
        <span className="text-[10px] font-medium text-muted-foreground">Add server</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. my-server)"
          className="h-7 text-xs"
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/mcp"
          className="h-7 text-xs"
        />
        <Textarea
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          placeholder={"Optional headers, one per line:\nAuthorization: Bearer ..."}
          className="min-h-[44px] text-xs"
          rows={2}
        />
        {error && <span className="text-[10px] text-destructive">{error}</span>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleAdd()}
          disabled={busy}
          className="h-7 self-start px-3 text-[10px]"
        >
          {busy ? "Adding…" : "Add server"}
        </Button>
      </div>
    </div>
  );
}
