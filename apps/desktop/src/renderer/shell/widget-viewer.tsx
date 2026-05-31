import { memo, useEffect, useMemo, useRef } from "react";
import { createStateStore, type StateStore } from "@json-render/core";
import { JSONUIProvider, Renderer, ValidationProvider } from "@json-render/react";
import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@/renderer/lib/bridge";
import { registerInstanceFlush } from "@/renderer/shell/instance-state-flush";
import { widgetRegistry } from "@/renderer/shell/widget-registry";
import { type JsonUiWidgetDef, type WidgetInstance } from "@/shared/shell";

// Tradeoff: frequent enough to feel live, coarse enough that a single
// keystroke doesn't hit IPC.
const STATE_PERSIST_DEBOUNCE_MS = 400;

type Props = { instance: WidgetInstance; def: JsonUiWidgetDef };

/**
 * Renders one placed instance of a custom widget — the definition's `spec`
 * against the instance's own bound `state`.
 *
 * State ownership is single-writer: this viewer owns the live bound state for
 * its lifetime. It seeds the json-render store once from the instance's
 * persisted state, then persists the full snapshot back to disk (debounced) —
 * a whole-object replace, so keys the user clears actually disappear. Agent
 * spec edits arrive through the `spec` prop and re-render without disturbing
 * live input state; an agent state reset reflects on the instance's next mount
 * (a deliberate, rare tradeoff).
 *
 * memo'd on the instance + spec references so a sibling's write — which the
 * store applies without touching this instance's identity — doesn't re-render
 * this one.
 */
export const WidgetViewer = memo(function WidgetViewer({ instance, def }: Props) {
  // Lazily create + seed the store on first render so bound components render
  // with the persisted state on the very first paint (no empty-then-fill
  // flash). Seeded once per mount; agent state resets reflect on remount.
  const storeRef = useRef<StateStore | null>(null);
  if (storeRef.current === null) storeRef.current = createStateStore(instance.state);
  const getStore = (): StateStore => {
    const store = storeRef.current;
    if (!store) throw new Error("Widget state store not initialized");
    return store;
  };

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only flush when the store actually changed since the last persist, so the
  // unconditional unmount flush doesn't re-send an unchanged snapshot.
  const dirtyRef = useRef(false);
  const idRef = useRef(instance.instanceId);
  idRef.current = instance.instanceId;

  // Per-`into`-path invocation counter for callTool: a slower earlier call
  // must not clobber a newer result written to the same path (latest-wins).
  const callSeqRef = useRef(new Map<string, number>());

  // Resolves with whether the latest pending state actually reached main, so
  // surface-change and unplace callers can tell a true success ("flushed" or
  // "nothing to flush") from a quiet failure (bridge missing, IPC threw). A
  // bare ack on failure would let main proceed with stale state.
  const flushPersist = useMemo(
    () => async (): Promise<boolean> => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (!dirtyRef.current) return true; // nothing pending → success
      const bridge = getBridge();
      if (!bridge) return false; // bridge not ready; stay dirty so a later flush retries
      // Optimistically clear `dirty` so an interleaved change during the
      // in-flight save isn't lost; only on save failure do we mark dirty again
      // (a successful save is final).
      dirtyRef.current = false;
      try {
        await bridge.setInstanceState(idRef.current, getStore().getSnapshot());
        return true;
      } catch {
        dirtyRef.current = true;
        return false;
      }
    },
    [],
  );

  // Persist on store changes (debounced). Flush on unmount so a change made
  // within the debounce window before close isn't lost. The store is already
  // seeded at first render, so this effect only wires persistence.
  useEffect(() => {
    const unsubscribe = getStore().subscribe(() => {
      dirtyRef.current = true;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => void flushPersist(), STATE_PERSIST_DEBOUNCE_MS);
    });
    const unregisterFlush = registerInstanceFlush(idRef.current, flushPersist);
    return () => {
      unsubscribe();
      unregisterFlush();
      void flushPersist();
    };
  }, [flushPersist]);

  const handlers = useMemo(() => {
    return {
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
        await getBridge()?.widgetOpenUrl(url);
      },
      // Live actions. generateText/fetchUrl write their result into the store
      // at `into`; the store subscriber persists it and bound components
      // re-render. Errors surface as a toast.
      // Fire-and-forget: the click handler shouldn't block on the IPC round-trip
      // (the json-render handler runner awaits whatever we return). Surface
      // bridge-missing immediately; surface IPC errors via the promise catch.
      sendPrompt: (params: Record<string, unknown>) => {
        const prompt = typeof params["prompt"] === "string" ? params["prompt"] : "";
        if (!prompt) return;
        const bridge = getBridge();
        if (!bridge) {
          toast.error("Agent unavailable");
          return;
        }
        bridge.widgetSendPrompt(prompt).catch((err) => {
          toast.error(err instanceof Error ? err.message : "Failed to send prompt");
        });
      },
      generateText: async (params: Record<string, unknown>) => {
        const prompt = typeof params["prompt"] === "string" ? params["prompt"] : "";
        const into = typeof params["into"] === "string" ? params["into"] : "";
        const system = typeof params["system"] === "string" ? params["system"] : undefined;
        if (!prompt || !into) return;
        try {
          const text = await getBridge()?.widgetComplete(prompt, system);
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
          const text = await getBridge()?.widgetFetch(url);
          if (typeof text === "string") getStore().set(into, text);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Fetch failed");
        }
      },
      // Calls a configured integration tool and writes its data into `into`.
      // On failure, route the message into the `error` state path when given
      // (so the widget can show it inline) and otherwise toast.
      callTool: async (params: Record<string, unknown>) => {
        const tool = typeof params["tool"] === "string" ? params["tool"] : "";
        const into = typeof params["into"] === "string" ? params["into"] : "";
        const errorPath = typeof params["error"] === "string" ? params["error"] : "";
        const input = params["input"];
        if (!tool || !into) return;
        // Resolve the bridge up front: a tool call returns arbitrary data
        // (including a legitimate null), so a missing bridge can't be told
        // apart from a real result downstream. Treat its absence as an error
        // rather than silently writing null over bound data.
        const bridge = getBridge();
        if (!bridge) {
          if (errorPath) getStore().set(errorPath, "Agent unavailable");
          else toast.error("Agent unavailable");
          return;
        }
        // Latest-wins per state path this call writes: claim a token for each
        // pointer, then only write a pointer if no newer call has claimed it.
        // Keying per pointer (not just `into`) means a success on one target
        // can't null out an error a concurrent call wrote to a shared `error`
        // pointer. When `error` coincides with `into` it's a single pointer —
        // claiming once and never clearing it on success.
        const seqMap = callSeqRef.current;
        const claim = (path: string): (() => boolean) => {
          const seq = (seqMap.get(path) ?? 0) + 1;
          seqMap.set(path, seq);
          return () => seqMap.get(path) === seq;
        };
        const intoLatest = claim(into);
        const errorLatest = errorPath && errorPath !== into ? claim(errorPath) : null;
        try {
          const data = await bridge.widgetCallTool(tool, input);
          if (intoLatest()) getStore().set(into, data ?? null);
          // Clear a stale error only if we still own the error pointer and it
          // isn't the path we just wrote the result to.
          if (errorLatest?.()) getStore().set(errorPath, null);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Tool call failed";
          if (!errorPath) toast.error(message);
          else if (errorPath === into ? intoLatest() : errorLatest?.())
            getStore().set(errorPath, message);
        }
      },
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3">
      <JSONUIProvider registry={widgetRegistry} store={getStore()} handlers={handlers}>
        {/* ValidationProvider connects the framework's built-in `validateForm`
         * action — without it, the action dispatches but no-ops with a console
         * warning. setState/pushState/removeState are framework built-ins too
         * and work automatically with the store passed to JSONUIProvider. */}
        <ValidationProvider>
          <Renderer spec={def.source.spec} registry={widgetRegistry} />
        </ValidationProvider>
      </JSONUIProvider>
    </div>
  );
});
