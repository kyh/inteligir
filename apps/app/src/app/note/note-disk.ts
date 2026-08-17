// THE open note's reader, and the only one. The initial load and every
// re-read a doc event provokes are the same coalesced request, so ONE event
// costs ONE read.
//
// react-query held this file too and answered the same event with its own
// refetch. Collapsing the other way — teaching the shared cache to tolerate
// the transient 404 a rename produces — was rejected: it would put a policy
// about THIS component's in-flight rename inside a cache any future reader
// inherits, in order to keep a second reader of a file the design says has
// exactly one owner. The buffer IS the file, so the note's bytes are not
// cache state, and nothing else in the app asks for them.
//
// Reads COALESCE: a burst (an agent turn writing repeatedly) holds ONE
// request in flight and collapses everything arriving during it into a single
// trailing re-read, so the last read always reflects the final disk state.
// What that bounds is the burst, not the pair: one service write announces
// itself TWICE to a `vault` subscriber (`notifyDoc` plus the vault
// files-changed carrying the same path, vault-service.ts), and both reach
// this reader as separate events — so a write still costs two reads, one per
// event. Collapsing that is a change to what the server announces.

import type { ApiClient } from "@repo/server-contract/client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, unwrap } from "../api";
import type { DocEvents } from "../workspace-context";

/** The read's answer, carrying the path it answers FOR — so a path change
 *  reads as "not loaded yet" in the same render, never as the previous note's
 *  bytes under the new name. */
type DiskState =
  | { path: string; status: "loading" }
  | { path: string; status: "ready"; content: string }
  | { path: string; status: "failed" };

export interface NoteDisk {
  /** The note's bytes as last read; null until the first read answers. */
  content: string | null;
  /** The first read failed with something that was not a 404. */
  failed: boolean;
  /**
   * While OUR rename is in flight the old path 404s by design, and that must
   * not be read as an external delete. Cleared by the caller when the rename
   * fails; a successful one changes the path, which resets everything.
   */
  setRenamePending: (pending: boolean) => void;
}

export interface NoteDiskArgs {
  api: ApiClient;
  docEvents: DocEvents;
  path: string;
  /** The note disappeared from disk under us (an external delete). */
  onVanished: () => void;
}

export function useNoteDisk({ api, docEvents, path, onVanished }: NoteDiskArgs): NoteDisk {
  const [state, setState] = useState<DiskState>({ path, status: "loading" });
  const renamePendingRef = useRef(false);
  const setRenamePending = useCallback((pending: boolean): void => {
    renamePendingRef.current = pending;
  }, []);

  // The vanish callback is read through a ref: a caller passing a fresh
  // closure must not re-subscribe the doc events and re-read the file.
  const onVanishedRef = useRef(onVanished);
  useLayoutEffect(() => {
    onVanishedRef.current = onVanished;
  });

  useEffect(() => {
    let cancelled = false;
    let inFlight: Promise<void> | null = null;
    let repeat = false;

    const readNow = async (): Promise<void> => {
      try {
        const data = await unwrap(await api.vault.file.$get({ query: { path } }));
        if (!cancelled) {
          setState({ path, status: "ready", content: data.content });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          if (!renamePendingRef.current) {
            onVanishedRef.current();
          }
          return;
        }
        // A re-read that fails leaves THIS path's last good bytes standing —
        // the buffer is live and the editor keeps working. Bytes belonging to
        // a note we have since navigated away from are not a fallback, so a
        // first read that fails reports the failure.
        setState((current) =>
          current.path === path && current.status === "ready"
            ? current
            : { path, status: "failed" },
        );
      }
    };

    const scheduleRead = (): void => {
      if (inFlight !== null) {
        repeat = true;
        return;
      }
      const run = (): Promise<void> =>
        readNow().finally(() => {
          inFlight = null;
          if (repeat) {
            repeat = false;
            scheduleRead();
          }
        });
      inFlight = run();
    };

    // Subscribed BEFORE the first read, so an event that lands while it is in
    // flight coalesces into the trailing re-read rather than being missed.
    const unsubscribe = docEvents.subscribe((docId) => {
      // A named folder covers the notes beneath it — a directory rename or
      // delete names the folder, never each file inside it. A null id is an
      // unnamed vault change, which asserts nothing.
      if (docId !== null && docId !== path && !path.startsWith(`${docId}/`)) {
        return;
      }
      scheduleRead();
    });
    scheduleRead();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, docEvents, path]);

  const current: DiskState = state.path === path ? state : { path, status: "loading" };
  return {
    content: current.status === "ready" ? current.content : null,
    failed: current.status === "failed",
    setRenamePending,
  };
}
