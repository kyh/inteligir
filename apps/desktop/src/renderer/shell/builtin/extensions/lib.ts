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
): { data: T | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refresh = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void loadRef
      .current(bridge)
      .then(setData)
      .catch((err: unknown) => onErrorRef.current(errorMessage(err, "Failed to load.")));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, refresh };
}

export type SectionProps = { onError: (e: string | null) => void };
