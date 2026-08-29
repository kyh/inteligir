// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  noteOpened,
  noteStepped,
  useNoteHistory,
  type NoteHistory,
  type NoteHistoryNav,
} from "../note-history";

afterEach(cleanup);

/** The history a run of opens leaves behind, so a case reads as the walk it
 *  describes rather than as a literal. */
function afterOpening(...paths: readonly string[]): NoteHistory {
  return paths.reduce<NoteHistory>((history, path) => noteOpened(history, path), null);
}

describe("the note-history machine", () => {
  it("has nowhere to go before the first note opens", () => {
    expect(noteStepped(null, -1)).toBeNull();
    expect(noteStepped(null, 1)).toBeNull();
  });

  it("stands on the first note with neither arrow lit", () => {
    const history = afterOpening("a.md");
    expect(history).toEqual({ back: [], current: "a.md", forward: [] });
    expect(noteStepped(history, -1)).toBeNull();
    expect(noteStepped(history, 1)).toBeNull();
  });

  it("re-opening the note already open is not a second entry", () => {
    const history = afterOpening("a.md");
    expect(noteOpened(history, "a.md")).toBe(history);
  });

  it("steps back onto the previous note and offers the way forward", () => {
    const stepped = noteStepped(afterOpening("a.md", "b.md"), -1);
    expect(stepped).toEqual({
      path: "a.md",
      history: { back: [], current: "a.md", forward: ["b.md"] },
    });
  });

  it("returns to where it stepped from", () => {
    const back = noteStepped(afterOpening("a.md", "b.md"), -1);
    expect(noteStepped(back?.history ?? null, 1)).toEqual({
      path: "b.md",
      history: { back: ["a.md"], current: "b.md", forward: [] },
    });
  });

  it("absorbs the step's own landing rather than pushing it again", () => {
    const back = noteStepped(afterOpening("a.md", "b.md"), -1);
    const landed = noteOpened(back?.history ?? null, "a.md");
    expect(landed).toBe(back?.history);
  });

  it("drops the forward tail when the user opens from the middle", () => {
    const back = noteStepped(afterOpening("a.md", "b.md"), -1);
    expect(noteOpened(back?.history ?? null, "c.md")).toEqual({
      back: ["a.md"],
      current: "c.md",
      forward: [],
    });
  });
});

/** The hook driven the way the app drives it: `go` asks the session to open a
 *  note, and the route mirrors that open back as the next `openNote`. */
function historyNav() {
  const opened: string[] = [];
  const view = renderHook<NoteHistoryNav, { openNote: string | null }>(
    ({ openNote }) => useNoteHistory(openNote, (path) => opened.push(path)),
    { initialProps: { openNote: null } },
  );
  const mirror = (path: string | null): void => {
    view.rerender({ openNote: path });
  };
  return {
    opened,
    arrows: () => ({
      canBack: view.result.current.canBack,
      canForward: view.result.current.canForward,
    }),
    open: mirror,
    /** A step the session lands: the route mirrors what `go` asked for. */
    step: (delta: -1 | 1): void => {
      const before = opened.length;
      act(() => {
        view.result.current.go(delta);
      });
      const asked = opened[before];
      if (asked !== undefined) {
        mirror(asked);
      }
    },
    /** A step the session REFUSES (a failed flush, a pane deflection): the
     *  route never changes. */
    stepUnlanded: (delta: -1 | 1): void => {
      act(() => {
        view.result.current.go(delta);
      });
    },
  };
}

describe("useNoteHistory", () => {
  it("lights the back arrow only once there is somewhere to go back to", () => {
    const nav = historyNav();
    expect(nav.arrows()).toEqual({ canBack: false, canForward: false });
    nav.open("a.md");
    expect(nav.arrows()).toEqual({ canBack: false, canForward: false });
    nav.open("b.md");
    expect(nav.arrows()).toEqual({ canBack: true, canForward: false });
  });

  it("opens through the session and follows the route's mirror", () => {
    const nav = historyNav();
    nav.open("a.md");
    nav.open("b.md");
    nav.step(-1);
    expect(nav.opened).toEqual(["a.md"]);
    expect(nav.arrows()).toEqual({ canBack: false, canForward: true });
  });

  it("does not re-push the note a step just opened", () => {
    const nav = historyNav();
    nav.open("a.md");
    nav.open("b.md");
    nav.step(-1);
    nav.step(1);
    nav.step(-1);
    // A landing pushed as a new destination would drop the forward tail with
    // it, so the walk forward finds nothing and the arrows stop agreeing with
    // the two notes that were ever opened.
    expect(nav.opened).toEqual(["a.md", "b.md", "a.md"]);
    expect(nav.arrows()).toEqual({ canBack: false, canForward: true });
  });

  it("does not swallow the next open when a step never lands", () => {
    const nav = historyNav();
    nav.open("a.md");
    nav.open("b.md");
    nav.stepUnlanded(-1);
    nav.open("c.md");
    expect(nav.arrows()).toEqual({ canBack: true, canForward: false });
  });
});
