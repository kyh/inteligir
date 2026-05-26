import { useEffect, useMemo, useRef, useState } from "react";
import { createStateStore, type Spec, type StateStore } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@/renderer/lib/bridge";
import { artifactRegistry } from "@/renderer/chat/artifact-registry";
import type { Artifact } from "@/shared/artifacts";
import { escapeSegment } from "@/shared/json-pointer";

// Tradeoff: frequent enough to feel live, coarse enough that a single
// keystroke doesn't hit IPC.
const STATE_PERSIST_DEBOUNCE_MS = 400;

type Props = { id: string };

/**
 * Renders a single artifact spec via json-render. Subscribes to ARTIFACTS_UPDATED
 * for live agent edits; persists user interactions back to disk on debounce.
 * Shows a "removed" placeholder when the underlying artifact is deleted.
 */
export function ArtifactViewer({ id }: Props) {
  const [artifact, setArtifact] = useState<Artifact | null | "missing">(null);

  const storeRef = useRef<StateStore | null>(null);
  const getStore = (): StateStore => {
    if (!storeRef.current) storeRef.current = createStateStore({});
    return storeRef.current;
  };

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArtifactRef = useRef<Artifact | null>(null);

  // Sparse merge patch — sending the whole snapshot would clobber state
  // keys the agent set concurrently (between our debounce schedule and the
  // IPC landing on the main side).
  const flushPersist = useMemo(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const snapshot = getStore().getSnapshot();
      const current = lastArtifactRef.current;
      if (!current) return;
      const patch = computeStatePatch(current.state, snapshot);
      if (Object.keys(patch).length === 0) return;
      void getBridge()?.patchArtifactState(current.id, patch).catch(() => null);
    },
    [],
  );

  // Merge model: every broadcast applies the agent's new state but re-overlays
  // the user's unpersisted diff so neither side clobbers the other. The store
  // subscriber decides whether persistence is needed via equality check; no
  // suppress flag required (works for sync OR async store notifications).
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    let initialized = false;

    const applyArtifact = (next: Artifact) => {
      const previous = lastArtifactRef.current;
      const prevSnapPointers = toPointerMap(getStore().getSnapshot());
      const prevBaselinePointers =
        initialized && previous ? toPointerMap(previous.state) : prevSnapPointers;
      const nextPointers = toPointerMap(next.state);
      const nextPathSet = new Set(Object.keys(nextPointers));

      lastArtifactRef.current = next;
      setArtifact(next);

      // One store update: broadcast paths, then user-diff paths (paths the
      // user changed since the last baseline), then `undefined` for paths
      // that no longer have a representation in next.state. The clear list
      // is filtered to skip a parent whose children are being set
      // ("/p" prev scalar -> "/p/child" next) and a descendant of a
      // newly-scalar path ("/p/c" prev -> "/p" next scalar) — either case
      // would corrupt the store mid-update.
      const updateMap: Record<string, unknown> = { ...nextPointers };
      if (initialized) {
        for (const [path, value] of Object.entries(prevSnapPointers)) {
          if (!leafEqual(value, prevBaselinePointers[path])) updateMap[path] = value;
        }
      }
      for (const path of Object.keys(prevSnapPointers)) {
        if (path in updateMap) continue;
        if (hasRelatedPath(path, nextPathSet)) continue;
        updateMap[path] = undefined;
      }
      getStore().update(updateMap);
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

    // Flush on unmount so a state change made within the debounce window
    // before close doesn't get lost.
    const unsubscribeStore = getStore().subscribe(() => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(flushPersist, STATE_PERSIST_DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      off();
      unsubscribeStore();
      flushPersist();
    };
    // NOTE: json-render docs say onStateChange is ignored when a `store`
    // prop is supplied to JSONUIProvider — that's why we wire persistence
    // via store.subscribe here, not the provider's callback.
  }, [id, flushPersist]);

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
      // Live actions. generateText/fetchUrl write their result into the
      // state store at `into`; the store subscriber persists it and any
      // bound component re-renders. Errors surface as a toast rather than
      // silently failing a button press.
      sendPrompt: (params: Record<string, unknown>) => {
        const prompt = typeof params["prompt"] === "string" ? params["prompt"] : "";
        if (!prompt) return;
        void getBridge()?.sendAgentCommand({ type: "user_message", text: prompt });
      },
      generateText: async (params: Record<string, unknown>) => {
        const prompt = typeof params["prompt"] === "string" ? params["prompt"] : "";
        const into = typeof params["into"] === "string" ? params["into"] : "";
        const system = typeof params["system"] === "string" ? params["system"] : undefined;
        if (!prompt || !into) return;
        try {
          const text = await getBridge()?.artifactComplete(prompt, system);
          if (typeof text === "string") getStore().set(into, text);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Generation failed");
        }
      },
      fetchUrl: async (params: Record<string, unknown>) => {
        const url = typeof params["url"] === "string" ? params["url"] : "";
        const into = typeof params["into"] === "string" ? params["into"] : "";
        if (!url || !into) return;
        try {
          const text = await getBridge()?.artifactFetch(url);
          if (typeof text === "string") getStore().set(into, text);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Fetch failed");
        }
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
 * `StateStore.update`. Arrays stay whole; only plain objects walk. Three
 * deltas from @json-render/core's flattenToPointers: (1) drops undefined
 * leaves so cleared paths and absent paths compare equal; (2) emits a `{}`
 * leaf for empty plain objects so `{ a: {} }` is distinguishable from `{}`;
 * (3) escapes `~` and `/` in keys per RFC 6901.
 */
function toPointerMap(
  value: unknown,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
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
    toPointerMap(child, `${prefix}/${escapeSegment(key)}`, out);
  }
  return out;
}

// Diff snapshot vs baseline as a sparse pointer-keyed patch. Only paths in
// snapshot that differ are emitted — the main side applies them as a merge,
// leaving concurrent agent-set siblings intact. Deletions aren't expressed
// (state paths are bound inputs; the model doesn't generate clears).
function computeStatePatch(
  baseline: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const baseMap = toPointerMap(baseline);
  const snapMap = toPointerMap(snapshot);
  const patch: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(snapMap)) {
    if (!leafEqual(value, baseMap[path])) patch[path] = value;
  }
  return patch;
}

/**
 * True if `target` matches any path in `paths`, is a strict ancestor of one
 * (e.g. "/a" vs "/a/b"), or is a strict descendant of one ("/a/b" vs "/a").
 * Used when clearing stale pointers so we don't blow away a parent object
 * whose children are being set, or a descendant of a scalar overwrite.
 */
function hasRelatedPath(target: string, paths: Set<string>): boolean {
  if (paths.has(target)) return true;
  const childPrefix = `${target}/`;
  for (const p of paths) {
    if (p.startsWith(childPrefix)) return true;
  }
  let idx = target.lastIndexOf("/");
  while (idx > 0) {
    if (paths.has(target.slice(0, idx))) return true;
    idx = target.lastIndexOf("/", idx - 1);
  }
  return false;
}

// toPointerMap walks plain-object leaves into nested paths, but arrays are
// kept whole — so a leaf may be an array containing objects, which need
// structural compare. Falls back to recursive own-key compare for object
// leaves to avoid false-unequal in that case (and for the empty-object leaf
// toPointerMap emits to distinguish `{a:{}}` from `{}`).
function leafEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => leafEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    if (ak.length !== Object.keys(b as object).length) return false;
    for (const k of ak) {
      if (!leafEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}
