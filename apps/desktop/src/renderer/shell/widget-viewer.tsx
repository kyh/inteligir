import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { createStateStore, type StateStore } from "@json-render/core";
import { JSONUIProvider, Renderer, useActions, ValidationProvider } from "@json-render/react";
import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@/renderer/lib/bridge";
import { registerInstanceFlush } from "@/renderer/shell/instance-state-flush";
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

  // Per-pointer baseline for vault live-refresh: the exact value the last
  // readDoc/readBlob wrote into each `into` pointer. A change event re-reads a
  // pointer only when its current state still equals this baseline — i.e. the
  // user hasn't edited it since. Precise per-pointer, so an unrelated state
  // change elsewhere in the widget never blocks (or triggers) a refresh.
  const vaultReadBaseline = useRef(new Map<string, unknown>());
  const canRefreshPointer = useCallback((into: string): boolean => {
    const baseline = vaultReadBaseline.current;
    // Never loaded yet → this is a first read, always allow.
    if (!baseline.has(into)) return true;
    const current = readJsonPointer(getStore().getSnapshot(), into);
    return jsonEqual(current, baseline.get(into));
  }, []);

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

  const handlers = useMemo(() => {
    // Vault read/write closures, shared by the doc/blob action aliases below.
    // Declared before the returned map so they're in scope without relying on
    // hoisting past a `return`.
    const vaultRead = (params: Record<string, unknown>): Promise<void> => {
      const filePath = typeof params["path"] === "string" ? params["path"] : "";
      const into = typeof params["into"] === "string" ? params["into"] : "";
      const errorPath = typeof params["error"] === "string" ? params["error"] : "";
      const reportError = (message: string): void => {
        if (errorPath) getStore().set(errorPath, message);
        else toast.error(message);
      };
      if (!filePath || !into) return Promise.resolve();
      const bridge = getBridge();
      if (!bridge) {
        reportError("Vault unavailable");
        return Promise.resolve();
      }
      // Latest-wins per `into`: a slow earlier read (e.g. onMount) must not land
      // after a newer refresh and write stale file content. Shares callTool's
      // per-path sequence map so reads and tool calls to the same pointer order.
      const seqMap = callSeqRef.current;
      const seq = (seqMap.get(into) ?? 0) + 1;
      seqMap.set(into, seq);
      const isLatest = (): boolean => seqMap.get(into) === seq;
      return bridge
        .widgetVaultRead({ path: filePath })
        .then((res) => {
          if (!isLatest()) return undefined;
          if (!res.ok) reportError(res.error);
          else {
            getStore().set(into, res.value);
            // Record what we wrote so the live-refresh can tell a later user
            // edit of this pointer apart from our own value.
            vaultReadBaseline.current.set(into, res.value);
            if (errorPath) getStore().set(errorPath, null);
          }
          return undefined;
        })
        .catch((err: unknown) => {
          // Only the latest read for this pointer may report — a superseded
          // read rejecting (IPC/transport failure) must not toast or set the
          // error pointer over a newer read that already owns `into`.
          if (!isLatest()) return;
          reportError(err instanceof Error ? err.message : "Vault read failed");
        });
    };
    const vaultWrite = (params: Record<string, unknown>): Promise<void> => {
      const filePath = typeof params["path"] === "string" ? params["path"] : "";
      const from = typeof params["from"] === "string" ? params["from"] : "";
      const errorPath = typeof params["error"] === "string" ? params["error"] : "";
      const reportError = (message: string): void => {
        if (errorPath) getStore().set(errorPath, message);
        else toast.error(message);
      };
      if (!filePath || !from) return Promise.resolve();
      const bridge = getBridge();
      if (!bridge) {
        reportError("Vault unavailable");
        return Promise.resolve();
      }
      const value = readJsonPointer(getStore().getSnapshot(), from);
      return bridge
        .widgetVaultWrite({ path: filePath, value })
        .then((res) => {
          if (!res.ok) reportError(res.error);
          else {
            // The file now holds `value` and state[from] === value, so they're
            // back in sync — refresh the baseline so live re-reads of this
            // pointer don't stay stuck treating it as user-edited forever.
            vaultReadBaseline.current.set(from, value);
            if (errorPath) getStore().set(errorPath, null);
          }
          return undefined;
        })
        .catch((err: unknown) => {
          reportError(err instanceof Error ? err.message : "Vault write failed");
        });
    };
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
        await getBridge()?.widgetOpenUrl({ url });
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
        bridge.widgetSendPrompt({ prompt }).catch((err) => {
          toast.error(err instanceof Error ? err.message : "Failed to send prompt");
        });
      },
      generateText: async (params: Record<string, unknown>) => {
        const prompt = typeof params["prompt"] === "string" ? params["prompt"] : "";
        const into = typeof params["into"] === "string" ? params["into"] : "";
        const system = typeof params["system"] === "string" ? params["system"] : undefined;
        if (!prompt || !into) return;
        try {
          const text = await getBridge()?.widgetComplete({
            prompt,
            ...(system === undefined ? {} : { system }),
          });
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
          const text = await getBridge()?.widgetFetch({ url });
          if (typeof text === "string") getStore().set(into, text);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Fetch failed");
        }
      },
      // Fetch JSON and route specific fields into specific state pointers. Bind
      // a Heading/Text to each path. We share widgetFetch's IPC (capped text +
      // redirect-safe) and only diverge on parsing + multi-target routing —
      // no new IPC channel, no widening of the trusted surface.
      fetchJson: async (params: Record<string, unknown>) => {
        const url = typeof params["url"] === "string" ? params["url"] : "";
        const errorPath = typeof params["error"] === "string" ? params["error"] : "";
        const paths = isPlainRecord(params["paths"]) ? params["paths"] : null;
        if (!url || !paths) return;
        const reportError = (message: string): void => {
          if (errorPath) getStore().set(errorPath, message);
          else toast.error(message);
        };
        try {
          const text = await getBridge()?.widgetFetch({ url });
          if (typeof text !== "string") return;
          const parsed: unknown = JSON.parse(text);
          for (const [dest, source] of Object.entries(paths)) {
            if (typeof source !== "string") continue;
            getStore().set(dest, readJsonPointer(parsed, source));
          }
          if (errorPath) getStore().set(errorPath, null);
        } catch (err) {
          reportError(err instanceof Error ? err.message : "Fetch failed");
        }
      },
      // Pure-renderer date stamper for "today" widgets. Same params shape as
      // fetchJson — destination pointer → field name — so the spec language
      // stays uniform.
      setNow: (params: Record<string, unknown>) => {
        const paths = isPlainRecord(params["paths"]) ? params["paths"] : null;
        if (!paths) return;
        const parts = formatNow();
        for (const [dest, field] of Object.entries(paths)) {
          if (typeof field !== "string" || !isNowField(field)) continue;
          getStore().set(dest, parts[field]);
        }
      },
      // Calls a configured integration tool and writes its data into `into`.
      // On failure, route the message into the `error` state path when given
      // (so the widget can show it inline) and otherwise toast.
      callTool: async (params: Record<string, unknown>) => {
        const tool = typeof params["tool"] === "string" ? params["tool"] : "";
        const into = typeof params["into"] === "string" ? params["into"] : "";
        const errorPath = typeof params["error"] === "string" ? params["error"] : "";
        // Optional sub-path into the response body to extract before writing
        // to `into`. Useful for APIs that wrap results in an envelope (e.g.
        // Google Calendar's `{ items: [...] }`). Pointer empty/absent → use
        // the whole response.
        const selectPath = typeof params["select"] === "string" ? params["select"] : "";
        // resolveAction only walks the top-level params map and only handles
        // `{$state}` at that layer (not $bindState, not recursion). Tool input
        // objects routinely carry nested dynamic values — e.g. timeMin set by
        // a setNow earlier in the same onMount sequence. Recursively resolve
        // here so widgets can write `input: { timeMin: { $state: '/now' } }`
        // and have the live state value reach the executor.
        const input = resolveStateRefs(params["input"], getStore().getSnapshot());
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
        // widgetCallTool returns a {ok,data|error} envelope — a failed tool
        // call resolves with ok:false rather than rejecting, so the message we
        // surface is the clean one from main, not Electron's IPC stack string.
        const writeError = (message: string): void => {
          if (!errorPath) toast.error(message);
          else if (errorPath === into ? intoLatest() : errorLatest?.())
            getStore().set(errorPath, message);
        };
        try {
          const res = await bridge.widgetCallTool({ tool, input });
          if (!res.ok) {
            writeError(res.error);
          } else {
            const value = selectPath ? readJsonPointer(res.data, selectPath) : res.data;
            if (intoLatest()) getStore().set(into, value ?? null);
            // Clear a stale error only if we still own the error pointer and it
            // isn't the path we just wrote the result to.
            if (errorLatest?.()) getStore().set(errorPath, null);
          }
        } catch (err) {
          // Transport-level failure (bridge unavailable / IPC rejected).
          writeError(err instanceof Error ? err.message : "Tool call failed");
        }
      },
      // Vault read: pull a file from the user's knowledge folder into state.
      // readDoc (markdown/text) and readBlob (parsed JSON) share one impl — main
      // serializes by file extension; the renderer just routes the value into
      // `into`. Re-fired automatically on vault changes (see OnMountRunner).
      readDoc: vaultRead,
      readBlob: vaultRead,
      // Vault write: persist the value at state pointer `from` to a vault file.
      // writeDoc (text) and writeBlob (JSON) share one impl — main serializes
      // by extension. Whole-file replace.
      writeDoc: vaultWrite,
      writeBlob: vaultWrite,
    };
  }, []);

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
        <pre className="overflow-auto rounded border border-border bg-muted/40 p-2 text-[10px] text-muted-foreground">
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
    <div className="flex flex-col gap-4 p-3">
      <JSONUIProvider registry={widgetRegistry} store={getStore()} handlers={handlers}>
        {/* ValidationProvider connects the framework's built-in `validateForm`
         * action — without it, the action dispatches but no-ops with a console
         * warning. setState/pushState/removeState are framework built-ins too
         * and work automatically with the store passed to JSONUIProvider. */}
        <ValidationProvider>
          <OnMountRunner spec={def.source.spec} store={getStore()} canRefresh={canRefreshPointer} />
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
function OnMountRunner({
  spec,
  store,
  canRefresh,
}: {
  spec: WidgetSpec;
  store: StateStore;
  /** Whether the read targeting this `into` pointer may refresh (false when the
   * user has edited it since our last read). */
  canRefresh: (into: string) => boolean;
}): null {
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

  // Live vault binding: when any vault file changes (the agent wrote a doc, the
  // user edited it in their editor, a sibling widget saved a blob), re-run this
  // widget's vault read loaders so what's on screen reflects the new data.
  // skipIf is intentionally ignored here — that gate is for first-mount caching,
  // and the whole point of a change event is to refresh past it.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const reads = (spec.onMount ?? []).filter(
      (a) => a.action === "readDoc" || a.action === "readBlob",
    );
    if (reads.length === 0) return;
    return bridge.onVaultChanged(() => {
      void (async () => {
        for (const a of reads) {
          // Skip only the pointer the user is actively editing — a readDoc/
          // readBlob whose `into` no longer matches what we last wrote there.
          // Other reads in the same widget still refresh.
          const into = typeof a.params?.["into"] === "string" ? a.params["into"] : "";
          if (into && !canRefresh(into)) continue;
          await execute({ action: a.action, params: a.params ?? {} }).catch(() => undefined);
        }
      })();
    });
  }, [spec, execute, canRefresh]);
  return null;
}

/**
 * "Non-empty" for `skipIf` caching: defined, not null, not "", not [], not {}.
 * Numbers (including 0) and booleans (including false) count as populated —
 * a temperature of 0°C is still real data the widget should not overwrite.
 */
function hasNonEmptyValue(state: Record<string, unknown>, pointer: string): boolean {
  const value = readJsonPointer(state, pointer);
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers for setNow / fetchJson
// ---------------------------------------------------------------------------

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural equality for vault values (strings or JSON-parsed data). Both
 * sides originate from JSON, so a serialized compare is sufficient and cheap. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Walk an unknown value, replacing every `{ $state: "/path" }` with the
 * resolved value at that path. Leaves everything else untouched. Used to
 * deep-resolve callTool's `input` object since json-render's built-in
 * resolveAction only walks the top-level params keys.
 */
function resolveStateRefs(value: unknown, state: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveStateRefs(v, state));
  if (!isPlainRecord(value)) return value;
  if (typeof value["$state"] === "string") {
    return readJsonPointer(state, value["$state"]);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = resolveStateRefs(v, state);
  }
  return out;
}

/**
 * Resolve a JSON pointer ("/a/b/0") against a parsed JSON value. Returns
 * `undefined` for an unresolvable path so the caller can choose to skip the
 * write. Empty pointer ("") returns the whole document.
 */
function readJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = value;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (isPlainRecord(cur)) {
      if (!(segment in cur)) return undefined;
      cur = cur[segment];
    } else {
      return undefined;
    }
  }
  return cur;
}

const NOW_FIELDS = [
  "dayShort",
  "dayLong",
  "dayNum",
  "monthShort",
  "monthLong",
  "year",
  "iso",
  "hourMinute12",
] as const;
type NowField = (typeof NOW_FIELDS)[number];
type NowParts = Record<NowField, string>;

function isNowField(field: string): field is NowField {
  return NOW_FIELDS.some((f) => f === field);
}

const DAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatNow(now: Date = new Date()): NowParts {
  const day = now.getDay();
  const month = now.getMonth();
  const hour24 = now.getHours();
  const minute = now.getMinutes();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    dayShort: DAYS_SHORT[day] ?? "",
    dayLong: DAYS_LONG[day] ?? "",
    dayNum: String(now.getDate()).padStart(2, "0"),
    monthShort: MONTHS_SHORT[month] ?? "",
    monthLong: MONTHS_LONG[month] ?? "",
    year: String(now.getFullYear()),
    iso: now.toISOString(),
    hourMinute12: `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`,
  };
}
