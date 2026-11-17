// CLAUDE.md § What the tab remembers is a field of a persisted store

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

const quietly = (touch: (storage: Storage) => void): void => {
  try {
    touch(window.localStorage);
  } catch {
    // A full or blocked store loses a preference, nothing more.
  }
};

// a Worker's render has no storage, so it reads every store's defaults
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

// a field reads a stored value it cannot parse as its default, so one bad field costs only itself
const field = <Schema extends z.ZodType>(schema: Schema, fallback: z.output<Schema>) =>
  // oxlint-disable-next-line promise/prefer-await-to-then, promise/valid-params -- zod's catch, not a promise's: it takes the fallback positionally
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

// Clamped with the rail's own bounds, or a stored width the rail cannot produce comes back on reload.
const paneWidth = z
  .number()
  .overwrite((px) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px))));

// the orders the grid offers; a search ranks, so it takes none of them
export const LIBRARY_SORTS = ["saved", "modified", "title"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

// the device's, so a change in one window reaches every other
export const devicePrefs = persisted(
  DEVICE_PREFS,
  z.object({
    appearance: appearanceSchema,
    // the document's own `spellcheck`, which every field inherits unless it sets its own
    spellcheck: field(z.boolean(), true),
    theme: field(themeName, "system"),
  }),
);

// the window's, so another window's moves stay there and the last any window made opens the next
export const windowLayout = persisted(
  "inteligir.layout",
  z.object({
    librarySort: field(z.enum(LIBRARY_SORTS), "saved"),
    // closed until asked for: the open item's panel button or an ask of the agent opens it
    panelOpen: field(z.boolean(), false),
    // the right panel is the same primitive as the rail, dragged by the same handle
    panelWidth: field(paneWidth, 320),
    railOpen: field(z.boolean(), true),
    railTagsOpen: field(z.boolean(), true),
    railWidth: field(paneWidth, 260),
  }),
);

// the account's, which every way of leaving it forgets (`cloud/account-storage.ts`)
export const accountPrefs = persisted(
  "inteligir.account",
  z.object({
    // whose the page's account storage is: its opaque id, as nothing here needs its address
    accountId: field(z.string().nullable(), null),
  }),
);

// One blob, so a window that missed another's write would put back what that one changed with its
// own next write.
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
): readonly [State[Key], (next: State[Key]) => void] => [
  useStore(store, (state) => state[key]),
  (next) => {
    const patch: Partial<State> = {};
    patch[key] = next;
    store.setState(patch);
  },
];
