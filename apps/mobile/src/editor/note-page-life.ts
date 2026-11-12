// A note page's life as native holds it: drawn and reading, so a leave goes at once; drawn while
// an edit made here may not be held, so a leave asks the page first; asking, one ask at a time,
// which the page answers by its number, a page that does not answer in time counting as not
// holding, since an edit it never sent would go with it; leaving, after which nothing asks; and
// released, a screen deep under others whose web view went once the note held. One step
// (`lifeAfter`) moves it on the page's report, the screen's depth, the connection coming back, a
// leave and an answer.

import type { NoteState, Settled } from "./page/page-host";

export const SETTLE_ANSWER_MS = 5000;

type NotePageLife =
  | { readonly kind: "reading" }
  | { readonly kind: "editing" }
  // `for`: what an answer that the note holds does, the leave or the web view let go
  | { readonly kind: "asking"; readonly ask: number; readonly for: "leave" | "release" }
  | { readonly kind: "leaving" }
  | { readonly kind: "released" };

// the life, the screen's depth, and the number of the last ask, which the page sees as `settle`
interface NotePage {
  readonly life: NotePageLife;
  readonly deep: boolean;
  readonly asked: number;
}

type LifeEvent =
  | { readonly kind: "reported"; readonly state: NoteState }
  | { readonly kind: "placed"; readonly deep: boolean }
  | { readonly kind: "reconnected" | "leave" | "discarded" }
  | { readonly kind: "answered"; readonly ask: number; readonly holds: boolean };

// the page is asked; the leave is made; the person is asked whether to leave without the edits
type LifeEffect = "ask" | "leave" | "confirm" | null;

interface LifeStep {
  readonly page: NotePage;
  readonly effect: LifeEffect;
}

export interface NotePageLifeStore {
  readonly get: () => NotePage;
  readonly subscribe: (listener: () => void) => () => void;
  readonly report: (state: NoteState) => void;
  readonly answer: (settled: Settled) => void;
  readonly place: (deep: boolean) => void;
  readonly reconnected: () => void;
  // a leave the screen was about to make: `go` makes it, and `confirm` asks the person, handed
  // the leave without the edits
  readonly leave: (go: () => void, confirm: (discard: () => void) => void) => void;
}

const stay = (page: NotePage): LifeStep => ({ effect: null, page });

const to = (page: NotePage, life: NotePageLife, effect: LifeEffect = null): LifeStep => ({
  effect,
  page: { ...page, life },
});

const asking = (page: NotePage, purpose: "leave" | "release"): LifeStep => ({
  effect: "ask",
  page: {
    ...page,
    asked: page.asked + 1,
    life: { ask: page.asked + 1, for: purpose, kind: "asking" },
  },
});

// a drawn page as its report or its depth leaves it
const drawn = (page: NotePage, editing: boolean): LifeStep => {
  if (editing) {
    return page.deep ? asking(page, "release") : to(page, { kind: "editing" });
  }
  return to(page, { kind: page.deep ? "released" : "reading" });
};

// an ask settled: a note that holds lets the leave or the web view go, and one that does not
// keeps the page drawn, the leave asking the person
const settled = (page: NotePage, purpose: "leave" | "release", holds: boolean): LifeStep => {
  if (holds) {
    return purpose === "leave"
      ? to(page, { kind: "leaving" }, "leave")
      : to(page, { kind: "released" });
  }
  return to(page, { kind: "editing" }, purpose === "leave" ? "confirm" : null);
};

const placedAfter = (page: NotePage, deep: boolean): LifeStep => {
  const { life } = page;
  const placed = { ...page, deep };
  switch (life.kind) {
    case "reading":
    case "editing": {
      return drawn(placed, life.kind === "editing");
    }
    case "released": {
      return to(placed, deep ? life : { kind: "reading" });
    }
    case "asking": {
      return to(placed, !deep && life.for === "release" ? { kind: "editing" } : life);
    }
    case "leaving": {
      return to(placed, life);
    }
    // no default
  }
};

const lifeAfter = (page: NotePage, event: LifeEvent): LifeStep => {
  const { life } = page;
  switch (event.kind) {
    case "reported": {
      const editing = event.state === "editing";
      if (life.kind === "reading" || life.kind === "editing") {
        return drawn(page, editing);
      }
      return life.kind === "asking" && !editing ? settled(page, life.for, true) : stay(page);
    }
    case "placed": {
      return placedAfter(page, event.deep);
    }
    case "reconnected": {
      return life.kind === "editing" && page.deep ? asking(page, "release") : stay(page);
    }
    case "leave": {
      if (life.kind === "editing") {
        return asking(page, "leave");
      }
      if (life.kind === "asking") {
        return life.for === "leave" ? stay(page) : to(page, { ...life, for: "leave" });
      }
      return life.kind === "leaving" ? stay(page) : to(page, { kind: "leaving" }, "leave");
    }
    case "answered": {
      return life.kind === "asking" && life.ask === event.ask
        ? settled(page, life.for, event.holds)
        : stay(page);
    }
    case "discarded": {
      return life.kind === "leaving" ? stay(page) : to(page, { kind: "leaving" }, "leave");
    }
    // no default
  }
};

export const notePageLife = ({ deep }: { readonly deep: boolean }): NotePageLifeStore => {
  let page: NotePage = { asked: 0, deep, life: { kind: deep ? "released" : "reading" } };
  const listeners = new Set<() => void>();
  // the leave an ask is for, made or confirmed once the page answers
  let leaving: { readonly go: () => void; readonly confirm: (discard: () => void) => void } | null =
    null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = (effect: LifeEffect, again: (event: LifeEvent) => void): void => {
    switch (effect) {
      case "ask": {
        const ask = page.asked;
        timer = setTimeout(() => {
          again({ ask, holds: false, kind: "answered" });
        }, SETTLE_ANSWER_MS);
        break;
      }
      case "leave": {
        leaving?.go();
        break;
      }
      case "confirm": {
        leaving?.confirm(() => {
          again({ kind: "discarded" });
        });
        break;
      }
      case null: {
        break;
      }
      // no default
    }
  };

  const step = (event: LifeEvent): void => {
    const { effect, page: next } = lifeAfter(page, event);
    if (page.life.kind === "asking" && next.life.kind !== "asking") {
      clearTimeout(timer);
    }
    const moved = next !== page;
    page = next;
    if (moved) {
      for (const listener of listeners) {
        listener();
      }
    }
    run(effect, step);
  };

  return {
    answer: ({ ask, holds }) => {
      step({ ask, holds, kind: "answered" });
    },
    get: () => page,
    leave: (go, confirm) => {
      if (page.life.kind !== "asking" || page.life.for !== "leave") {
        leaving = { confirm, go };
      }
      step({ kind: "leave" });
    },
    place: (placedDeep) => {
      step({ deep: placedDeep, kind: "placed" });
    },
    reconnected: () => {
      step({ kind: "reconnected" });
    },
    report: (state) => {
      step({ kind: "reported", state });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
