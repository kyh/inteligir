// Renderer wiring for the inteligir:// nav verbs (today / note/<target> /
// search?q=). Bridge-only — no electron/node (lint-enforced). The connection
// order is load-bearing: subscribe onDeepLinkNav FIRST, then pull the parked
// nav — pulling first drops a nav that lands in the gap on cold launch; the
// id dedupe collapses the overlap where the same nav arrives on both
// channels (pushed while we're subscribed AND still parked when we pull).

import { useEffect, useEffectEvent } from "react";

import { toast } from "@repo/ui/components/sonner";

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { DeepLinkNav, DeepLinkNavEvent } from "@repo/bridge/deep-link";

import { getBridge } from "@renderer/lib/bridge";
import { useOpenDailyNote } from "@renderer/workspace/use-note-templates";
import { useVault } from "@renderer/workspace/vault-context";

export type DeepLinkNavPorts = {
  /** Subscribe to pushed nav events. Returns unsubscribe. */
  subscribe: (listener: (event: DeepLinkNavEvent) => void) => () => void;
  /** Pull-and-clear the parked nav (cold launch). */
  takePending: () => Promise<DeepLinkNavEvent | null>;
  dispatch: (nav: DeepLinkNav) => void;
};

/** The pure connection protocol (exported for the race test): subscribe,
 * THEN pull, dedupe by event id. Returns a disposer. */
export function connectDeepLinkNav(ports: DeepLinkNavPorts): () => void {
  const handledIds = new Set<string>();
  let disposed = false;
  const handle = (event: DeepLinkNavEvent): void => {
    if (disposed || handledIds.has(event.id)) return;
    handledIds.add(event.id);
    ports.dispatch(event.nav);
  };
  const unsubscribe = ports.subscribe(handle);
  ports
    .takePending()
    .then((pending) => {
      if (pending !== null) handle(pending);
      return undefined;
    })
    .catch(() => {});
  return () => {
    disposed = true;
    unsubscribe();
  };
}

/**
 * Mounts the deep-link nav listener. Lives inside VaultProvider (it opens
 * notes through useVault); `onSearch` opens the command palette with the
 * query prefilled.
 */
export function useDeepLinkNav(onSearch: (query: string) => void): void {
  const { entries, openFile, resolveWikiTarget } = useVault();
  const openDailyNote = useOpenDailyNote();

  // Effect-event so the one-shot subscription reads live vault state.
  const dispatch = useEffectEvent((nav: DeepLinkNav) => {
    switch (nav.kind) {
      case "today":
        openDailyNote();
        return;
      case "note": {
        // Exact vault-relative path always wins; wiki-title resolution is the
        // convenience form. The resolved path is re-guarded doc-only — a wiki
        // target can resolve to an asset, and nav must never open one (or an
        // HTML App; the parser already rejected extensioned non-docs).
        const exact = entries.some((entry) => entry.path === nav.target) ? nav.target : null;
        const resolved =
          exact ?? resolveWikiTarget(nav.target) ?? (isDocPath(nav.target) ? nav.target : null);
        if (resolved === null || !isDocPath(resolved)) {
          toast.error(`Note not found: ${nav.target}`);
          return;
        }
        openFile(resolved);
        return;
      }
      case "search":
        onSearch(nav.query);
        return;
    }
  });

  useEffect(() => {
    const bridge = getBridge();
    return connectDeepLinkNav({
      subscribe: (listener) => bridge.onDeepLinkNav(listener),
      takePending: () => bridge.takePendingDeepLinkNav(),
      dispatch,
    });
  }, []);
}
