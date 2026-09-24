// What this window remembers across a reload: one row per stored key, whose schema decodes the
// stored string and encodes the value back, so a key's reader and its writer cannot disagree on
// its bytes. Bytes a row cannot decode read as its fallback, like a key never written.

import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@repo/ui/components/sidebar-core";
import { parseTheme } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { useCallback, useState } from "react";
import { z } from "zod";
import { spellcheckChoiceSchema } from "../../spellcheck-state";
import { APPEARANCE_DEFAULTS, appearanceSchema } from "./appearance-options";

export interface PagePref<Value, Fallback> {
  readonly key: string;
  readonly schema: z.ZodType<Value, string>;
  readonly fallback: Fallback;
}

const pref = <Value>(
  key: string,
  schema: z.ZodType<Value, string>,
  fallback: NoInfer<Value>,
): PagePref<Value, Value> => ({ fallback, key, schema });

const unsetPref = <Value>(
  key: string,
  schema: z.ZodType<Value, string>,
): PagePref<Value, null> => ({
  fallback: null,
  key,
  schema,
});

const json = <Value>(schema: z.ZodType<Value>) =>
  z.codec(z.string(), z.unknown().pipe(schema), {
    decode: (raw, payload) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        return parsed;
      } catch {
        payload.issues.push({ code: "custom", input: raw, message: "not JSON" });
        return z.NEVER;
      }
    },
    encode: (value) => JSON.stringify(value),
  });

const flag = z.stringbool({ case: "sensitive", falsy: ["false"], truthy: ["true"] });

// Clamped with the rail's own bounds, or a stored width the rail cannot produce comes back on reload.
const railWidth = z.codec(
  z.string(),
  z
    .number()
    .overwrite((px) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)))),
  { decode: Number, encode: String },
);

const themeName = z.string().refine((raw): raw is Theme => parseTheme(raw) === raw);

// in the order the rail's view menu lists them
export const RAIL_VIEWS = ["recent", "files", "deleted"] as const;
export type RailView = (typeof RAIL_VIEWS)[number];

const TREE_SORTS = ["name", "modified"] as const;
export type TreeSort = (typeof TREE_SORTS)[number];

export const PREFS = {
  appearance: pref("inteligir.appearance", json(appearanceSchema), APPEARANCE_DEFAULTS),
  lastOpenNote: unsetPref("inteligir.last-open-note", z.string()),
  // closed until asked for: a comment focus or the top bar's Comments opens it
  panelOpen: pref("inteligir.panel-open", flag, false),
  // the right panel is the same primitive as the rail, dragged by the same handle
  panelWidth: pref("inteligir.panel-width", railWidth, 320),
  railView: pref("inteligir.rail-view", z.enum(RAIL_VIEWS), "files"),
  relatedOpen: pref("inteligir.related-open", flag, true),
  sidebarWidth: pref("inteligir.sidebar-width", railWidth, 260),
  spellcheck: unsetPref("inteligir.spellcheck", json(spellcheckChoiceSchema)),
  theme: pref("inteligir.theme", themeName, "system"),
  treeSort: pref("inteligir.tree-sort", z.enum(TREE_SORTS), "name"),
};

const store = (key: string, value: string | null): void => {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // A full or blocked store loses a preference, nothing more.
  }
};

export const readPref = <Value, Fallback>(row: PagePref<Value, Fallback>): Value | Fallback => {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(row.key);
  } catch {
    return row.fallback;
  }
  if (raw === null) {
    return row.fallback;
  }
  const decoded = row.schema.safeParse(raw);
  return decoded.success ? decoded.data : row.fallback;
};

export const writePref = <Value>(row: PagePref<Value, unknown>, value: Value): void => {
  store(row.key, row.schema.encode(value));
};

export const forgetPref = (row: PagePref<unknown, unknown>): void => {
  store(row.key, null);
};

export const usePref = <Value>(
  row: PagePref<Value, Value>,
): readonly [Value, (next: Value) => void] => {
  const [value, setValue] = useState(() => readPref(row));
  const choose = useCallback(
    (next: Value): void => {
      writePref(row, next);
      setValue(next);
    },
    [row],
  );
  return [value, choose];
};
