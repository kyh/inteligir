import { useEffect, useMemo, useRef, useState } from "react";
import { createStateStore, type Spec, type StateStore } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@/renderer/lib/bridge";
import { artifactRegistry } from "@/renderer/chat/artifact-registry";
import type { Artifact } from "@/shared/artifacts";

// Debounce window for persisting bound-state changes (checkbox toggles,
// typed input, etc.) back to disk. Frequent enough to feel "live", coarse
// enough that a single keystroke doesn't hit the IPC layer every time.
const STATE_PERSIST_DEBOUNCE_MS = 400;

type Props = { id: string };

/**
 * Render a single artifact from `~/.inteligir/artifacts.json`. Subscribes to
 * ARTIFACTS_UPDATED so agent rewrites swap the spec live; persists user
 * interactions (via `$bindState`) back to disk with a small debounce.
 *
 * Renders a "removed" placeholder if the artifact no longer exists (e.g.
 * the agent deleted it while a panel was still open).
 */
export function ArtifactViewer({ id }: Props) {
  const [artifact, setArtifact] = useState<Artifact | null | "missing">(null);

  // The state store is owned by this viewer for the lifetime of the open
  // panel — we update it imperatively when the spec/state changes upstream.
  const storeRef = useRef<StateStore | null>(null);
  const getStore = (): StateStore => {
    if (!storeRef.current) storeRef.current = createStateStore({});
    return storeRef.current;
  };

  // Debounced persistence. Only the latest snapshot wins.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArtifactRef = useRef<Artifact | null>(null);

  // Subscribe first, then read. Note: we seed the state store from disk ONLY
  // on the first artifact we receive (initial load). Subsequent agent
  // broadcasts update the spec but leave the state store alone — the store
  // is owned by this viewer + the user, and clobbering it would
  //   (a) discard unpersisted local interactions sitting in the debounce
  //       window, and
  //   (b) cause onStateChange to re-fire and trigger a persistence cycle
  //       that loops back through ARTIFACTS_UPDATED.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    let initialized = false;

    const applyArtifact = (next: Artifact) => {
      lastArtifactRef.current = next;
      if (!initialized) {
        getStore().update(toPointerMap(next.state));
        initialized = true;
      }
      setArtifact(next);
    };

    const off = bridge.onArtifactsUpdated((list) => {
      if (cancelled) return;
      const next = list.artifacts.find((a) => a.id === id);
      if (next) {
        applyArtifact(next);
      } else if (initialized) {
        // Was open, agent deleted it — show the placeholder.
        lastArtifactRef.current = null;
        setArtifact("missing");
      }
    });

    bridge
      .getArtifact(id)
      .then((found) => {
        if (cancelled || initialized) return null;
        if (!found) {
          setArtifact("missing");
          return null;
        }
        applyArtifact(found);
        return null;
      })
      .catch(() => null);

    return () => {
      cancelled = true;
      off();
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [id]);

  // Persist state changes via the state-only IPC. Critically NOT upsert —
  // upsert would carry our cached spec back to disk and could clobber an
  // agent-authored spec update that landed during the debounce window.
  const handleStateChange = useMemo(
    () => () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        const snapshot = getStore().getSnapshot();
        const current = lastArtifactRef.current;
        if (!current) return;
        // Skip persistence if nothing actually changed vs. the last-known
        // baseline — avoids round-tripping the same state back through
        // ARTIFACTS_UPDATED on every render cycle.
        if (shallowEqualPointers(current.state, snapshot)) return;
        lastArtifactRef.current = { ...current, state: snapshot };
        void getBridge()?.patchArtifactState(current.id, snapshot).catch(() => null);
      }, STATE_PERSIST_DEBOUNCE_MS);
    },
    [],
  );

  const handlers = useMemo(
    () => ({
      notify: (params: Record<string, unknown>) => {
        const message = typeof params["message"] === "string" ? params["message"] : "";
        if (!message) return;
        const variant = params["variant"];
        if (variant === "success") toast.success(message);
        else if (variant === "error") toast.error(message);
        else toast(message);
      },
      openUrl: async (params: Record<string, unknown>) => {
        const url = typeof params["url"] === "string" ? params["url"] : "";
        if (!url) return;
        await getBridge()?.openExternal(url);
      },
    }),
    [],
  );

  if (artifact === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
  }
  if (artifact === "missing") {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        This artifact has been removed.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <JSONUIProvider
        registry={artifactRegistry}
        store={getStore()}
        handlers={handlers}
        onStateChange={handleStateChange}
      >
        <Renderer spec={artifact.spec as unknown as Spec} registry={artifactRegistry} />
      </JSONUIProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object into a `{ "/json/pointer": value }` map for
 * `StateStore.update`. Arrays stay whole; only plain objects walk.
 *
 * An empty plain object at a non-root path emits a `{}` leaf so the
 * equality check can distinguish `{ a: {} }` from `{}`.
 */
function toPointerMap(
  value: unknown,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    if (prefix.length === 0) return out;
    out[prefix] = value;
    return out;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    if (prefix.length === 0) return out;
    out[prefix] = {};
    return out;
  }
  for (const [key, child] of entries) {
    toPointerMap(child, `${prefix}/${key}`, out);
  }
  return out;
}

/**
 * Compare two state snapshots by flattening both to pointer maps and
 * checking value-by-value. Skips re-persistence when nothing changed.
 *
 * Leaf comparison handles arrays element-wise (toPointerMap keeps arrays
 * whole, so reference equality would falsely flag every array as
 * different). Plain objects don't appear as leaves — toPointerMap walks
 * them into nested pointers — but we still fall back to JSON for safety.
 */
function shallowEqualPointers(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aMap = toPointerMap(a);
  const bMap = toPointerMap(b);
  const aKeys = Object.keys(aMap);
  if (aKeys.length !== Object.keys(bMap).length) return false;
  for (const k of aKeys) {
    if (!leafEqual(aMap[k], bMap[k])) return false;
  }
  return true;
}

function leafEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => leafEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
