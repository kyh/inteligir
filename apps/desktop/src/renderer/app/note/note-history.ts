// Back/forward over opened notes (the top bar's arrows) — session state, and
// a machine that touches no React, so what the arrows mean is unit-testable
// without a renderer. The hook below is the wiring: one value React renders
// on, so the arrows' enabled state is DERIVED rather than force-refreshed.

import { useCallback, useEffect, useState } from "react";

/**
 * Where the user is standing and what lies either side of them: a zipper
 * rather than a stack-plus-cursor, because an index is a second value that
 * can disagree with the array it indexes. `null` until the first note opens —
 * with nowhere to stand, neither arrow means anything.
 */
export type NoteHistory = {
  /** Notes behind `current`, nearest first. */
  readonly back: readonly string[];
  readonly current: string;
  /** Notes ahead of `current`, nearest first. */
  readonly forward: readonly string[];
} | null;

/**
 * The user opened `path`. Opening from anywhere but the front drops the
 * forward tail, like a browser.
 *
 * A step's own landing arrives here too — the session mirrors every open back
 * — and is absorbed by the `current` check rather than by a flag the stepper
 * sets: the note the machine just moved to IS the note that opened, so
 * nothing needs to be remembered between the two, and a step whose open never
 * lands (a refused flush, a pane deflection) cannot leave a flag armed to
 * swallow the next genuine open.
 */
export function noteOpened(history: NoteHistory, path: string): NoteHistory {
  if (history === null) {
    return { back: [], current: path, forward: [] };
  }
  if (history.current === path) {
    return history;
  }
  return { back: [history.current, ...history.back], current: path, forward: [] };
}

/** The move `delta` asks for and the note it lands on, or null when that
 *  direction is exhausted. */
export function noteStepped(
  history: NoteHistory,
  delta: -1 | 1,
): { history: NoteHistory; path: string } | null {
  if (history === null) {
    return null;
  }
  if (delta === -1) {
    const [path, ...back] = history.back;
    if (path === undefined) {
      return null;
    }
    return {
      path,
      history: { back, current: path, forward: [history.current, ...history.forward] },
    };
  }
  const [path, ...forward] = history.forward;
  if (path === undefined) {
    return null;
  }
  return {
    path,
    history: { back: [history.current, ...history.back], current: path, forward },
  };
}

export interface NoteHistoryNav {
  canBack: boolean;
  canForward: boolean;
  go: (delta: -1 | 1) => void;
}

/**
 * Back/forward for the open note. `openNote` is the route's mirror of what is
 * open — every open reaches this machine through it, whoever started it.
 *
 * A step drives the SESSION (flush-then-switch) rather than the route: the
 * route mirrors back from publishOpenPath like every other open, which is
 * also what tells the machine the step landed.
 */
export function useNoteHistory(
  openNote: string | null,
  openFile: (path: string) => void,
): NoteHistoryNav {
  const [history, setHistory] = useState<NoteHistory>(null);
  useEffect(() => {
    if (openNote === null) return;
    setHistory((current) => noteOpened(current, openNote));
  }, [openNote]);

  const go = useCallback(
    (delta: -1 | 1): void => {
      const stepped = noteStepped(history, delta);
      if (stepped === null) return;
      setHistory(stepped.history);
      openFile(stepped.path);
    },
    [history, openFile],
  );

  return {
    canBack: history !== null && history.back.length > 0,
    canForward: history !== null && history.forward.length > 0,
    go,
  };
}
