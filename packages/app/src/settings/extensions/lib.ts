// Shared helpers for the Extensions panel's per-section components.

import { useCallback, useEffect, useRef, useState } from "react";

import { getBridge } from "../../lib/bridge";
import type { OAuthStartInput } from "@repo/core/executor";
import type { DesktopBridge } from "@repo/core/ipc";

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
 * Wrap a dialog's `onOpenChange` so a close request is ignored while a submit is
 * in flight — the submit flow owns closing, and a stray dismiss (Escape/overlay/
 * X) could otherwise strand half-created state or wipe a re-opened form.
 */
export function blockDismissWhileBusy(
  busy: boolean,
  onOpenChange: (open: boolean) => void,
): (open: boolean) => void {
  return (open) => {
    if (!open && busy) return;
    onOpenChange(open);
  };
}

const OAUTH_POLL_MS = 1500;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

/**
 * Run an executor OAuth flow to mint a connection: start the session with a
 * registered client, open the authorization URL in the system browser, then
 * poll the one-shot await endpoint (keyed by the OAuth `state`) until the
 * callback fires. Resolves once connected; throws on failure or timeout.
 */
export async function runOAuthFlow(bridge: DesktopBridge, input: OAuthStartInput): Promise<void> {
  const start = await bridge.executorOAuthStart(input);
  // Inline completion (client_credentials grants) — nothing to wait for.
  if (start.status === "connected") return;
  await bridge.executorOpenExternal(start.authorizationUrl);
  const deadline = Date.now() + OAUTH_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error("OAuth timed out.");
    await new Promise((r) => setTimeout(r, OAUTH_POLL_MS));
    const result = await bridge.executorOAuthAwait(start.state);
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
): { data: T | null; error: string | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  // Lets callers tell "still loading" (data null, no error) apart from "load
  // failed" (so they can show a retry instead of a stuck spinner).
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refresh = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return Promise.resolve();
    setError(null);
    return loadRef
      .current(bridge)
      .then((value) => {
        setData(value);
        // Clear a stale panel banner once the load recovers (e.g. after Retry).
        onErrorRef.current(null);
        return undefined;
      })
      .catch((err: unknown) => {
        const message = errorMessage(err, "Failed to load.");
        setError(message);
        onErrorRef.current(message);
      });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, refresh };
}

export type SectionProps = { onError: (e: string | null) => void };
