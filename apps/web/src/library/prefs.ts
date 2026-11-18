import { listingSortSchema } from "@repo/contract/library/listing-sort";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@repo/ui/lib/sidebar-bounds";
import { parseTheme } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { z } from "zod";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { appearanceSchema } from "./appearance-options";
import { DEVICE_PREFS } from "./no-flash-theme";

const quietly = (touch: (storage: Storage) => void) => {
  try {
    touch(window.localStorage);

    return true;
  } catch {
    return false;
  }
};

const quietLocalStorage: StateStorage<void> = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  removeItem: (name) => {
    quietly((storage) => {
      storage.removeItem(name);
    });
  },
  setItem: (name, value) => {
    quietly((storage) => {
      storage.setItem(name, value);
    });
  },
};

const field = <Schema extends z.ZodType>(schema: Schema, fallback: z.output<Schema>) =>
  // oxlint-disable-next-line promise/valid-params -- zod's catch, not a promise's: it takes the fallback positionally
  z.catch(schema, fallback);

const persisted = <State extends object>(name: string, schema: z.ZodType<State>) =>
  createStore<State>()(
    persist(() => schema.parse({}), {
      merge: (stored, current) => {
        const read = schema.safeParse(stored);

        return read.success ? read.data : current;
      },
      name,
      storage: createJSONStorage(() => quietLocalStorage),
    }),
  );

const themeName = z.string().refine((raw): raw is Theme => parseTheme(raw) === raw);

const paneWidth = z
  .number()
  .overwrite((px) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px))));

export const LIBRARY_SORTS = listingSortSchema.options;

export type LibrarySort = z.infer<typeof listingSortSchema>;

export const devicePrefs = persisted(
  DEVICE_PREFS,
  z.object({
    appearance: appearanceSchema,
    spellcheck: field(z.boolean(), true),
    theme: field(themeName, "system"),
  }),
);

export const windowLayout = persisted(
  "inteligir.layout",
  z.object({
    librarySort: field(listingSortSchema, "saved"),
    panelOpen: field(z.boolean(), false),
    panelWidth: field(paneWidth, 320),
    railOpen: field(z.boolean(), true),
    railTagsOpen: field(z.boolean(), true),
    railWidth: field(paneWidth, 260),
  }),
);

export const accountPrefs = persisted(
  "inteligir.account",
  z.object({
    accountId: field(z.string().nullable(), null),
  }),
);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === DEVICE_PREFS) {
      void devicePrefs.persist.rehydrate();
    }
  });
}

export const usePref = <State extends object, Key extends keyof State>(
  store: StoreApi<State>,
  key: Key,
) =>
  [
    useStore(store, (state) => state[key]),
    (next) => {
      const patch: Partial<State> = {};
      patch[key] = next;
      store.setState(patch);
    },
  ] satisfies readonly [State[Key], (next: State[Key]) => void];
