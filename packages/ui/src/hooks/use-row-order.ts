// The row registry the lists here share (SidebarMenu, DropdownMenuContent, CommandDialog). A row
// does not answer for its own position: it hands the list its element, and the list reads
// document order itself. Registering only marks the set dirty, so the rows one commit mounts or
// unmounts are read once, in the layout phase of the commit after, before anything paints.

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { flushSync } from "react-dom";

import { useIsoLayoutEffect } from "@repo/ui/lib/use-iso-layout-effect";

export const sameElements = (a: readonly HTMLElement[], b: readonly HTMLElement[]): boolean =>
  a.length === b.length && a.every((element, index) => element === b[index]);

const orderIn = (
  container: HTMLElement | null,
  selector: string,
  registered: ReadonlySet<HTMLElement>,
): HTMLElement[] =>
  container === null
    ? []
    : [...container.querySelectorAll<HTMLElement>(selector)].filter((element) =>
        registered.has(element),
      );

const addsRow = (record: MutationRecord, selector: string): boolean =>
  [...record.addedNodes].some(
    (node) =>
      node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null),
  );

interface RowOrder {
  // the registered rows in document order
  rows: readonly HTMLElement[];
  registerRow: (element: HTMLElement) => () => void;
  // for a fact about the rows that `onRows` derives and no registration announces
  requestSync: () => void;
}

interface OrderWatch {
  node: HTMLElement;
  selector: string;
  observer: MutationObserver;
}

// `onRows` runs in the layout phase after every sync with the rows in document order, so it
// must be stable: a new one each render would re-read the list on every render.
export const useRowOrder = (
  containerRef: RefObject<HTMLElement | null>,
  selector: string,
  onRows: (rows: readonly HTMLElement[]) => void,
): RowOrder => {
  const registeredRef = useRef(new Set<HTMLElement>());
  const syncedRef = useRef<readonly HTMLElement[]>([]);
  const watchRef = useRef<OrderWatch | null>(null);
  const [rows, setRows] = useState<readonly HTMLElement[]>([]);
  // the trigger: a layout-phase update is flushed before paint, and N of them in one commit are
  // one render
  const [version, setVersion] = useState(0);

  const requestSync = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  const registerRow = useCallback(
    (element: HTMLElement) => {
      registeredRef.current.add(element);
      requestSync();
      return () => {
        registeredRef.current.delete(element);
        requestSync();
      };
    },
    [requestSync],
  );

  useIsoLayoutEffect(() => {
    const container = containerRef.current;
    const order = orderIn(container, selector, registeredRef.current);
    syncedRef.current = order;
    setRows((previous) => (sameElements(previous, order) ? previous : order));
    onRows(order);

    // Watched from here rather than from a ref callback: a portal's node mounts after the owner,
    // and a composed ref is a new function each render, whose detach would disconnect the
    // observer and drop the records of the very commit that moved the rows.
    const watched = watchRef.current;
    if (watched?.node === container && watched.selector === selector) {
      return;
    }
    watched?.observer.disconnect();
    watchRef.current = null;
    if (container === null || globalThis.MutationObserver === undefined) {
      return;
    }
    // A keyed reorder moves rows without mounting one, so no registration announces it. The
    // resync is flushed before paint, or the pills would draw a frame against the old order.
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => addsRow(record, selector))) {
        return;
      }
      if (sameElements(orderIn(container, selector, registeredRef.current), syncedRef.current)) {
        return;
      }
      flushSync(requestSync);
    });
    observer.observe(container, { childList: true, subtree: true });
    watchRef.current = { node: container, observer, selector };
  }, [version, containerRef, selector, onRows, requestSync]);

  useIsoLayoutEffect(
    () => () => {
      watchRef.current?.observer.disconnect();
      watchRef.current = null;
    },
    [],
  );

  return { registerRow, requestSync, rows };
};

// A value the list publishes after each commit and its rows read through useSyncExternalStore:
// as the highlight travels, only the rows whose own reading of it flipped re-render, never the
// whole list.
export interface HighlightStore<T> {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
}

export const useHighlightStore = <T>(value: T): HighlightStore<T> => {
  const valueRef = useRef(value);
  const listenersRef = useRef(new Set<() => void>());
  const store = useMemo<HighlightStore<T>>(
    () => ({
      get: () => valueRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );
  useIsoLayoutEffect(() => {
    valueRef.current = value;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [value]);
  return store;
};

const unsubscribeNothing = (): void => {
  // a row outside any list subscribed to nothing
};
const subscribeNowhere = (): (() => void) => unsubscribeNothing;

// a row outside any list reads false
export const useHighlighted = <T>(
  store: HighlightStore<T> | null,
  select: (value: T) => boolean,
): boolean =>
  useSyncExternalStore(
    store?.subscribe ?? subscribeNowhere,
    () => store !== null && select(store.get()),
    () => false,
  );
