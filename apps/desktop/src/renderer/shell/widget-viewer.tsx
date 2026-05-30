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

  // Returns a Promise that resolves when the latest pending state has reached
  // main — so surface-change and unplace callers can await it and avoid
  // remount-with-stale-state races.
  const flushPersist = useMemo(
    () => async (): Promise<void> => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (!dirtyRef.current) return;
      const bridge = getBridge();
      if (!bridge) return; // bridge not ready; stay dirty so a later flush retries
      // Optimistically clear `dirty` so an interleaved change during the
      // in-flight save isn't lost; only on save failure do we mark dirty again
      // (a successful save is final).
      dirtyRef.current = false;
      try {
        await bridge.setInstanceState(idRef.current, getStore().getSnapshot());
      } catch {
        dirtyRef.current = true;
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
