// What this window remembers across a reload: one row per stored key, whose schema decodes the
// stored string and encodes the value back, so a key's reader and its writer cannot disagree on
// its bytes. Bytes a row cannot decode read as its fallback, like a key never written.

import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@repo/ui/components/sidebar-core";
import { parseTheme } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { useCallback, useState } from "react";
import { z } from "zod";

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

export const PREFS = {
  // closed until asked for: opening an action or the panel's toggle opens it
  panelOpen: pref("inteligir.panel-open", flag, false),
  // the right panel is the same primitive as the rail, dragged by the same handle
  panelWidth: pref("inteligir.panel-width", railWidth, 320),
  sidebarWidth: pref("inteligir.sidebar-width", railWidth, 260),
  // the document's own `spellcheck`, which every field inherits unless it sets its own
  spellcheck: pref("inteligir.spellcheck", flag, true),
  theme: pref("inteligir.theme", themeName, "system"),
};

const store = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
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
