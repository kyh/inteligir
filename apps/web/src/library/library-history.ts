import type { ItemKind } from "@repo/contract/items/item-kind";
import type { LibraryScope } from "@repo/contract/library-scope";
import { useSyncExternalStore } from "react";

import { libraryHref, parseLibraryAddress, scopeAddress } from "./library-address";
import type { LibraryAddress } from "./library-address";

interface Shown {
  readonly href: string;
  readonly address: LibraryAddress;
}

interface LeaveGate {
  readonly holdsWork: () => boolean;
  readonly mayLeave: () => Promise<boolean>;
}

const listeners = new Set<() => void>();
let shown: Shown | null = null;
let gate: LeaveGate | null = null;

const hrefNow = () => `${window.location.pathname}${window.location.search}`;

const read = () => {
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

const told = () => {
  for (const listener of listeners) {
    listener();
  }
};

const write = (to: LibraryAddress, replace: boolean) => {
  const href = libraryHref(to);

  if (replace) {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }

  told();
};

const popped = () => {
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

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) {
    window.addEventListener("popstate", popped);
  }

  listeners.add(listener);

  return (() => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      window.removeEventListener("popstate", popped);
    }
  }) satisfies () => void;
};

export const useLibraryAddress = () => useSyncExternalStore(subscribe, read);

export const guardLeaves = (guard: LeaveGate) => {
  gate = guard;

  return (() => {
    if (gate === guard) {
      gate = null;
    }
  }) satisfies () => void;
};

interface Move {
  readonly replace?: boolean;
  readonly unasked?: boolean;
}

const go = async (to: LibraryAddress, { replace = false, unasked = false }: Move = {}) => {
  const guard = gate;

  if (!unasked && guard !== null && to.openItem !== read().openItem && !(await guard.mayLeave())) {
    return;
  }

  write(to, replace);
};

const toItem = (openItem: string | null, find: string | null, unasked: boolean) => {
  const now = read();
  void go({ ...now, find, openItem }, { replace: openItem === now.openItem, unasked });
};

export const libraryGoes = {
  closeItem: (leave?: { readonly unasked: true }) => {
    toItem(null, null, leave?.unasked === true);
  },
  closeSettings: () => {
    void go({ ...read(), settings: false });
  },
  dropFind: () => {
    write({ ...read(), find: null }, true);
  },
  now: read,
  openItem: (itemId: string, find?: string) => {
    toItem(itemId, find ?? null, false);
  },
  openSettings: () => {
    void go({ ...read(), settings: true });
  },
  showKind: (kind: ItemKind | null) => {
    void go({ ...read(), kind }, { replace: true });
  },
  showScope: (scope: LibraryScope) => {
    void go(scopeAddress(scope));
  },
};

export type LibraryGoes = typeof libraryGoes;
