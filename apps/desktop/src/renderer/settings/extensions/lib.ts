// Shared helpers for the Extensions panel's per-section components.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getBridge } from "@renderer/lib/bridge";
import { toErrorMessage } from "@repo/features/wire-helpers";
import type { Bridge } from "@repo/features/ipc-registry";

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
  load: (bridge: Bridge) => Promise<T>,
  onError: (e: string | null) => void,
): { data: T | null; error: string | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  // Lets callers tell "still loading" (data null, no error) apart from "load
  // failed" (so they can show a retry instead of a stuck spinner).
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    loadRef.current = load;
    onErrorRef.current = onError;
  }, [load, onError]);

  const refresh = useCallback(() => {
    const bridge = getBridge();
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
        const message = toErrorMessage(err, "Failed to load.");
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
