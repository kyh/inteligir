// Shared helpers for the Extensions panel's per-section components.

import { useCallback, useEffect, useRef, useState } from "react";

import { getBridge } from "@/renderer/lib/bridge";
import type { DesktopBridge } from "@/shared/ipc";

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "source"
  );
}

/**
 * Normalize a URL for loose equality: lowercase the scheme and host and drop a
 * trailing slash. The path/query are left as-is, since they're case-sensitive
 * per RFC 3986. Falls back to a whole-string lowercase for non-URL inputs.
 */
export function normalizeUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

const OAUTH_POLL_MS = 1500;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

/**
 * Run executor's dynamic-DCR OAuth flow against an endpoint: start the session,
 * open the authorization URL in the browser, then poll until the callback
 * fires. Resolves once connected; throws on failure or timeout.
 */
export async function runOAuthFlow(
  bridge: DesktopBridge,
  endpoint: string,
  connectionId: string,
): Promise<void> {
  const start = await bridge.executorOAuthStart({ endpoint, pluginId: "mcp", connectionId });
  if (start.completedConnection) return;
  if (!start.authorizationUrl) throw new Error("No authorization URL returned.");
  await bridge.executorOpenExternal(start.authorizationUrl);
  const deadline = Date.now() + OAUTH_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error("OAuth timed out.");
    await new Promise((r) => setTimeout(r, OAUTH_POLL_MS));
    const result = await bridge.executorOAuthAwait(start.sessionId);
    if (!result) continue;
    if (!result.ok) throw new Error(`OAuth failed: ${result.error}`);
    return;
  }
}

export function parseHeaders(raw: string): Record<string, string> | undefined {
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

/**
 * Load a resource from the bridge on mount and expose `refresh()`. Reads
 * `load`/`onError` through refs so `refresh` is stable; callers can pass inline
 * closures without re-fetching every render.
 */
export function useBridgeResource<T>(
  load: (bridge: DesktopBridge) => Promise<T>,
  onError: (e: string | null) => void,
): { data: T | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refresh = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return Promise.resolve();
    return loadRef
      .current(bridge)
      .then(setData)
      .catch((err: unknown) => onErrorRef.current(errorMessage(err, "Failed to load.")));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, refresh };
}

export type SectionProps = { onError: (e: string | null) => void };
