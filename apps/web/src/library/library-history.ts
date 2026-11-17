// CLAUDE.md § Where the tab is rides the URL. Where the tab is, read from the window's address,
// and every move of it a shallow entry of the window's history, so Back and Forward walk them and
// Next renders nothing anew. A command and the editor's host, which is asked outside React, move
// it by one spelling and read it as they are asked.
//
// The address is this module's own store over `window.location`, not Next's
// `useSearchParams`: a leave off an item holding an edit is refused before anything renders the
// new address, and Next's popstate handler would hand its hooks the popped address first.

import type { ItemKind } from "@repo/contract/items/item-kind";
import type { LibraryScope } from "@repo/contract/library-scope";
import { useSyncExternalStore } from "react";

import { libraryHref, parseLibraryAddress } from "./library-address";
import type { LibraryAddress } from "./library-address";

interface Shown {
  readonly href: string;
  readonly address: LibraryAddress;
}

// what guards the open item's edit, the workspace's while it is mounted
interface LeaveGate {
  // whether a leave now would wait on an edit or lose it, asked the moment Back or Forward lands
  readonly holdsWork: () => boolean;
  // whether the tab may leave the item, waiting for it to keep what it holds
  readonly mayLeave: () => Promise<boolean>;
}

const listeners = new Set<() => void>();
let shown: Shown | null = null;
let gate: LeaveGate | null = null;

const hrefNow = (): string => `${window.location.pathname}${window.location.search}`;

const read = (): LibraryAddress => {
  const href = hrefNow();
  if (shown?.href !== href) {
    shown = {
      address: parseLibraryAddress(
        window.location.pathname,
        new URLSearchParams(window.location.search),
      ),
      href,
    };
  }
  return shown.address;
};

const told = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const write = (to: LibraryAddress, replace: boolean): void => {
  const href = libraryHref(to);
  if (replace) {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }
  told();
};

// Back or Forward off an item holding an edit puts the item's entry back before anything draws the
// address it popped to, then goes there once the item keeps the edit or the person gives it up
const popped = (): void => {
  const from = shown;
  const to = parseLibraryAddress(
    window.location.pathname,
    new URLSearchParams(window.location.search),
  );
  const guard = gate;
  if (
    from === null ||
    guard === null ||
    to.openItem === from.address.openItem ||
    !guard.holdsWork()
  ) {
    told();
    return;
  }
  window.history.pushState(null, "", from.href);
  void (async () => {
    if (await guard.mayLeave()) {
      write(to, false);
    }
  })();
};

const subscribe = (listener: () => void): (() => void) => {
  if (listeners.size === 0) {
    window.addEventListener("popstate", popped);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("popstate", popped);
    }
  };
};

export const useLibraryAddress = (): LibraryAddress => useSyncExternalStore(subscribe, read);

export const guardLeaves = (guard: LeaveGate): (() => void) => {
  gate = guard;
  return () => {
    if (gate === guard) {
      gate = null;
    }
  };
};

interface Move {
  // a narrowing, not a place of its own, so Back returns past it
  readonly replace?: boolean;
  // a leave made on the person's word, so it is not asked about again
  readonly unasked?: boolean;
}

const go = async (to: LibraryAddress, { replace = false, unasked = false }: Move = {}) => {
  const guard = gate;
  if (!unasked && guard !== null && to.openItem !== read().openItem && !(await guard.mayLeave())) {
    return;
  }
  write(to, replace);
};

// on the page the tab is on, so an open that lands while Settings covers the workspace keeps it;
// the item already open is replaced, so a hit found in it adds no entry to go Back through
const toItem = (openItem: string | null, find: string | null, unasked: boolean): void => {
  const now = read();
  void go({ ...now, find, openItem }, { replace: openItem === now.openItem, unasked });
};

export const libraryGoes = {
  // back to the grid; a leave made on the person's word is not asked about again
  closeItem: (leave?: { readonly unasked: true }): void => {
    toItem(null, null, leave?.unasked === true);
  },
  closeSettings: (): void => {
    void go({ ...read(), settings: false });
  },
  // the find bar is on the words, so a reload or Back opens no bar
  dropFind: (): void => {
    write({ ...read(), find: null }, true);
  },
  now: read,
  // with the words a search found it by, which its find bar opens on
  openItem: (itemId: string, find?: string): void => {
    toItem(itemId, find ?? null, false);
  },
  openSettings: (): void => {
    void go({ ...read(), settings: true });
  },
  showKind: (kind: ItemKind | null): void => {
    void go({ ...read(), kind }, { replace: true });
  },
  // a new entry with no kind and no item, so Back walks scopes and the leave guard asks once
  showScope: (scope: LibraryScope): void => {
    void go({ find: null, kind: null, openItem: null, scope, settings: false });
  },
};

export type LibraryGoes = typeof libraryGoes;
