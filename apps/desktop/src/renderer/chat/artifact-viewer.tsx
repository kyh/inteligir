import { useEffect, useMemo, useRef } from "react";
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

type Props = { artifact: Artifact };

/**
 * Renders one artifact spec via json-render.
 *
 * State ownership is single-writer: this viewer owns the live bound state for
 * its lifetime. It seeds the json-render store once from the artifact's
 * persisted state, then persists user interaction back to disk (debounced).
 * Agent spec edits arrive through the `artifact` prop and re-render the spec
 * without disturbing live input state. (An agent that resets state via
 * manage_artifacts reflects on the panel's next mount — a deliberate, rare
 * tradeoff that keeps this component free of cross-writer merge logic.)
 */
export function ArtifactViewer({ artifact }: Props) {
  // Baseline = last state known to be on disk, used to diff out a sparse
  // patch (so a persist touches only the keys the user changed, not the whole
  // blob). Updated after each persist.
  const baselineRef = useRef<Record<string, unknown>>(artifact.state);

  // Lazily create + seed the store on first render so bound components render
  // with the persisted state on the very first paint (no empty-then-fill
  // flash). Seeded once per mount; agent state resets reflect on remount.
  const storeRef = useRef<StateStore | null>(null);
  if (storeRef.current === null) storeRef.current = createStateStore(artifact.state);
  const getStore = (): StateStore => storeRef.current!;

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(artifact.id);
  idRef.current = artifact.id;

  const flushPersist = useMemo(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const snapshot = getStore().getSnapshot();
      const patch = computeStatePatch(baselineRef.current, snapshot);
      if (Object.keys(patch).length === 0) return;
      baselineRef.current = snapshot;
      void getBridge()?.patchArtifactState(idRef.current, patch).catch(() => null);
    },
    [],
  );

  // Persist on store changes (debounced). Flush on unmount so a change made
  // within the debounce window before close isn't lost. The store is already
  // seeded at first render, so this effect only wires persistence.
  useEffect(() => {
    const unsubscribe = getStore().subscribe(() => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(flushPersist, STATE_PERSIST_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      flushPersist();
    };
  }, [flushPersist]);

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
        await getBridge()?.artifactOpenUrl(url);
      },
      // Live actions. generateText/fetchUrl write their result into the store
      // at `into`; the store subscriber persists it and bound components
      // re-render. Errors surface as a toast.
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

  return (
    <div className="flex flex-col gap-4 p-3">
      <JSONUIProvider registry={artifactRegistry} store={getStore()} handlers={handlers}>
        <Renderer spec={artifact.spec as unknown as Spec} registry={artifactRegistry} />
      </JSONUIProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State pointer helpers
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object into a `{ "/json/pointer": value }` map. Arrays stay
 * whole; only plain objects walk. Escapes `~` and `/` in keys per RFC 6901.
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
    toPointerMap(child, `${prefix}/${escapeSegment(key)}`, out);
  }
  return out;
}

// Sparse diff of snapshot vs baseline — only changed paths. Main applies it as
// a merge, leaving any concurrent agent-set siblings intact.
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

// Leaves are primitives, whole arrays, or the `{}` empty-object leaf
// toPointerMap emits — all need structural (not reference) comparison.
function leafEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN !== NaN; treat two NaNs as equal so a NaN leaf doesn't produce a
  // phantom diff on every flush (which would loop re-persisting forever).
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => leafEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    if (ak.length !== Object.keys(b as object).length) return false;
    return ak.every((k) =>
      leafEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}
