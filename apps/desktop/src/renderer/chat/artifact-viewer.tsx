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

  // Persist state changes via the state-only IPC. Critically NOT upsert —
  // upsert would carry our cached spec back to disk and could clobber an
  // agent-authored spec update that landed during the debounce window.
  //
  // Defined before the subscribe effect so the effect's cleanup can flush
  // the pending debounce on unmount instead of just clearing the timer.
  const flushPersist = useMemo(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const snapshot = getStore().getSnapshot();
      const current = lastArtifactRef.current;
      if (!current) return;
      // Skip persistence if the store snapshot matches the baseline (the
      // last known on-disk / agent-broadcast state). Covers both "no real
      // change" and "broadcast made store match disk".
      if (shallowEqualPointers(current.state, snapshot)) return;
      lastArtifactRef.current = { ...current, state: snapshot };
      void getBridge()?.patchArtifactState(current.id, snapshot).catch(() => null);
    },
    [],
  );

  // Subscribe first, then read. On every artifact event we MERGE: take the
  // broadcast's state as the baseline, then re-overlay any unpersisted
  // user diff (paths the user changed since the last applied artifact) so
  // neither side clobbers the other. The store subscriber (handleStateChange)
  // serves as the single source of truth for whether persistence is needed —
  // it compares snapshot to lastArtifactRef.current.state and no-ops on
  // equality. We do NOT suppress notifications during applyArtifact's
  // store.update calls:
  //   - If the merge leaves a user diff in the store, we WANT the listener
  //     to schedule a persist so the diff lands on disk even if no further
  //     user interaction follows.
  //   - If the merge produces no diff, the equality check skips persistence,
  //     so there's no loop.
  // Relying on equality (not suppression) also avoids depending on whether
  // the store fires its subscribers synchronously or asynchronously.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    let initialized = false;

    const applyArtifact = (next: Artifact) => {
      const previous = lastArtifactRef.current;
      const userDiff =
        initialized && previous
          ? computeDiff(previous.state, getStore().getSnapshot())
          : null;

      lastArtifactRef.current = next;
      setArtifact(next);

      // Build the update map: new paths from the broadcast PLUS `undefined`
      // for paths that were in the store but aren't in next.state. Without
      // this, removed paths would linger in the store and get re-persisted
      // to disk on the next sync. toPointerMap drops undefined leaves, so
      // the equality check sees the cleared store and the broadcast state
      // as matching.
      const prevSnapshotPointers = toPointerMap(getStore().getSnapshot());
      const nextPointers = toPointerMap(next.state);
      const updateMap: Record<string, unknown> = { ...nextPointers };
      for (const path of Object.keys(prevSnapshotPointers)) {
        if (!(path in nextPointers)) updateMap[path] = undefined;
      }
      getStore().update(updateMap);
      if (userDiff && Object.keys(userDiff).length > 0) {
        getStore().update(userDiff);
      }
      initialized = true;
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
      // Flush any pending state-change debounce synchronously so the
      // user's last interaction within 400ms of closing the panel isn't
      // discarded. flushPersist no-ops when there's nothing pending.
      flushPersist();
    };
  }, [id, flushPersist]);

  // Schedule a debounced flush whenever the StateStore notifies. Wired via
  // `store.subscribe` (NOT JSONUIProvider's `onStateChange`) — when a
  // `store` prop is supplied, json-render docs say onStateChange is ignored.
  const handleStateChange = useMemo(
    () => () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(flushPersist, STATE_PERSIST_DEBOUNCE_MS);
    },
    [flushPersist],
  );

  useEffect(() => {
    const unsubscribe = getStore().subscribe(handleStateChange);
    return () => unsubscribe();
  }, [handleStateChange]);

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
      <JSONUIProvider registry={artifactRegistry} store={getStore()} handlers={handlers}>
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
  // Skip undefined leaves entirely so a key that was explicitly cleared
  // (set to undefined to "remove" a path from the JS state model) doesn't
  // appear in the pointer map. Keeps equality checks and IPC payloads
  // consistent between "no key" and "key=undefined" representations.
  if (value === undefined) return out;
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
    // RFC 6901: escape `~` -> `~0` and `/` -> `~1` per JSON Pointer rules
    // so keys containing those characters don't collide with the path
    // separator or escape sentinel.
    const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
    toPointerMap(child, `${prefix}/${escaped}`, out);
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

/**
 * Compute the set of pointer paths where `snapshot` diverges from
 * `baseline`. Returned as a `{ "/json/pointer": value }` map suitable for
 * `StateStore.update`. Used by applyArtifact to preserve the user's
 * unpersisted local changes when re-seeding the store from a broadcast.
 *
 * Only handles additions/changes — paths present in baseline but absent
 * from snapshot aren't represented (StateStore.update has no delete
 * semantics, and the bound-state model doesn't generate them in practice).
 */
function computeDiff(
  baseline: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const baseMap = toPointerMap(baseline);
  const snapMap = toPointerMap(snapshot);
  const diff: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(snapMap)) {
    if (!leafEqual(value, baseMap[path])) {
      diff[path] = value;
    }
  }
  return diff;
}
