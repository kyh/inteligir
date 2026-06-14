import { memo, useEffect, useMemo, useRef } from "react";
import { createStateStore, type StateStore } from "@json-render/core";
import { JSONUIProvider, Renderer, useActions, ValidationProvider } from "@json-render/react";

import { getBridge } from "@/renderer/lib/bridge";
import { registerInstanceFlush } from "@/renderer/shell/instance-state-flush";
import { createWidgetHandlers, hasNonEmptyValue } from "@/renderer/shell/widget-actions";
import { widgetRegistry } from "@/renderer/shell/widget-registry";
import { type JsonUiWidgetDef, type WidgetInstance } from "@/shared/shell";
import { toRendererSpec, validateWidgetProps, type WidgetSpec } from "@/shared/widget-spec";

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
        await bridge.setInstanceState({
          instanceId: idRef.current,
          state: getStore().getSnapshot(),
        });
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

  // Built once per mount over the stable store getter + call sequencer (the
  // implementations live in widget-actions.ts).
  const handlers = useMemo(() => createWidgetHandlers(getStore, callSeqRef), []);

  // Per-element prop validation, defense-in-depth. The authoritative check
  // runs at the write boundary (parseWidgetSpec in main rejects bad props
  // into the manage_ui tool result); this re-run of the same shared TypeBox
  // walker catches legacy defs written before that gate existed. It cannot
  // be replaced by json-render's catalog.validate(), which falls back to a
  // permissive any-record for multi-component catalogs.
  const validation = useMemo(() => validateWidgetProps(def.source.spec), [def.source.spec]);

  if (!validation.success) {
    const message = validation.issues
      .map((issue) => `${issue.elementKey} (${issue.component}).${issue.path}: ${issue.message}`)
      .join("\n");
    return (
      <div className="flex flex-col gap-2 p-3 text-xs">
        <p className="font-medium text-destructive">Widget spec is invalid</p>
        <pre className="overflow-auto rounded-[10px] bg-muted p-2 text-[10px] text-muted-foreground">
          {message}
        </pre>
        <p className="text-[10px] text-muted-foreground">
          Ask the agent to fix the spec — likely an unknown prop, or text passed via{" "}
          <code>props.children</code> instead of a separate Text element.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2.5 text-[13px]">
      <JSONUIProvider registry={widgetRegistry} store={getStore()} handlers={handlers}>
        {/* ValidationProvider connects the framework's built-in `validateForm`
         * action — without it, the action dispatches but no-ops with a console
         * warning. setState/pushState/removeState are framework built-ins too
         * and work automatically with the store passed to JSONUIProvider. */}
        <ValidationProvider>
          <OnMountRunner spec={def.source.spec} store={getStore()} />
          <Renderer spec={toRendererSpec(def.source.spec)} registry={widgetRegistry} />
        </ValidationProvider>
      </JSONUIProvider>
    </div>
  );
});

/**
 * Fires the spec's onMount actions exactly once after first render. Must live
 * inside the JSONUIProvider tree so it can reach `useActions().execute`, which
 * runs both host handlers (fetchJson, callTool, ...) and framework built-ins
 * (setState, pushState) through the same machinery as user-triggered actions.
 *
 * Keyed off the spec object identity: an in-place spec edit re-fires (so the
 * agent can re-load), a sibling write doesn't.
 */
function OnMountRunner({ spec, store }: { spec: WidgetSpec; store: StateStore }): null {
  const { execute } = useActions();
  const lastSpecRef = useRef<WidgetSpec | null>(null);
  useEffect(() => {
    if (lastSpecRef.current === spec) return;
    lastSpecRef.current = spec;
    const actions = spec.onMount ?? [];
    if (actions.length === 0) return;
    // Snapshot once outside the loop — actions earlier in the list may write
    // into state, but `skipIf` is meant to gate against PERSISTED state from
    // prior runs, not against state another onMount action just produced.
    const snapshot = store.getSnapshot();
    void (async () => {
      for (const a of actions) {
        if (a.skipIf !== undefined && hasNonEmptyValue(snapshot, a.skipIf)) continue;
        await execute({ action: a.action, params: a.params ?? {} }).catch(() => undefined);
      }
    })();
  }, [spec, execute, store]);
  return null;
}
