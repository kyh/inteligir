// ---------------------------------------------------------------------------
// Action handlers + pure helpers for the custom-widget viewer. Extracted from
// widget-viewer.tsx so the viewer stays focused on store seeding, persistence,
// and render. createWidgetHandlers closes over the viewer's live store getter
// and per-path call sequencer; everything else (bridge, toast) is module-level.
// ---------------------------------------------------------------------------

import type { StateStore } from "@json-render/core";
import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@/renderer/lib/bridge";

/** Build the live action handlers for one widget viewer instance.
 *
 * @param getStore   reads the viewer's live json-render store.
 * @param callSeqRef per-path invocation counter for callTool + vault reads/
 *   writes, so a slower earlier call can't clobber a newer one at the same path.
 * @param vaultBaseline per-`into` baseline the live refresh compares against to
 *   tell a user edit from our own value (see widget-viewer's canRefresh).
 */
export function createWidgetHandlers(
  getStore: () => StateStore,
  callSeqRef: { current: Map<string, number> },
  vaultBaseline: { current: Map<string, unknown> },
) {
  // Vault read/write closures, shared by the doc/blob action aliases below.
  // readDoc/readBlob and writeDoc/writeBlob differ only in intent — main
  // serializes by file extension; the renderer just routes the value.
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
    // after a newer refresh. Shares the per-path sequence map with callTool.
    const seqMap = callSeqRef.current;
    const seq = (seqMap.get(into) ?? 0) + 1;
    seqMap.set(into, seq);
    const isLatest = (): boolean => seqMap.get(into) === seq;
    // The pointer's value when the read started — if it changed by the time the
    // read resolves, the user edited `into` mid-read, so don't clobber it.
    const before = readJsonPointer(getStore().getSnapshot(), into);
    return bridge
      .widgetVaultRead({ path: filePath })
      .then((res) => {
        if (!isLatest()) return undefined;
        if (!res.ok) {
          reportError(res.error);
          return undefined;
        }
        if (!jsonEqual(readJsonPointer(getStore().getSnapshot(), into), before)) {
          return undefined; // edited during the read — the edit wins
        }
        getStore().set(into, res.value);
        vaultBaseline.current.set(into, res.value);
        if (errorPath) getStore().set(errorPath, null);
        return undefined;
      })
      .catch((err: unknown) => {
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
    // Latest-wins per target file (keyed by path; reads key by `into`, so they
    // share the map without colliding).
    const seqMap = callSeqRef.current;
    const wseq = (seqMap.get(filePath) ?? 0) + 1;
    seqMap.set(filePath, wseq);
    const isLatest = (): boolean => seqMap.get(filePath) === wseq;
    const value = readJsonPointer(getStore().getSnapshot(), from);
    return bridge
      .widgetVaultWrite({ path: filePath, value })
      .then((res) => {
        if (!isLatest()) return undefined;
        if (!res.ok) reportError(res.error);
        else {
          // The file now holds `value`; if state[from] still equals it they're
          // in sync, so refresh the baseline (keep it user-edited otherwise).
          if (jsonEqual(readJsonPointer(getStore().getSnapshot(), from), value)) {
            vaultBaseline.current.set(from, value);
          }
          if (errorPath) getStore().set(errorPath, null);
        }
        return undefined;
      })
      .catch((err: unknown) => {
        if (!isLatest()) return;
        reportError(err instanceof Error ? err.message : "Vault write failed");
      });
  };

  return {
    // Vault: pull a file into state / persist state to a file. doc=markdown/
    // text, blob=JSON — main serializes by extension; the renderer routes.
    readDoc: vaultRead,
    readBlob: vaultRead,
    writeDoc: vaultWrite,
    writeBlob: vaultWrite,
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
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (state-pointer resolution, skipIf checks, date formatting)
// ---------------------------------------------------------------------------

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
export function readJsonPointer(value: unknown, pointer: string): unknown {
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

/** Structural equality for vault values (strings or JSON-parsed data). Both
 * sides originate from JSON, so a serialized compare is sufficient and cheap. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * "Non-empty" for `skipIf` caching: defined, not null, not "", not [], not {}.
 * Numbers (including 0) and booleans (including false) count as populated —
 * a temperature of 0°C is still real data the widget should not overwrite.
 */
export function hasNonEmptyValue(state: Record<string, unknown>, pointer: string): boolean {
  const value = readJsonPointer(state, pointer);
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
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
