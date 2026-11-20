import { HOLDS_ANSWER_MS } from "@repo/client/note-bodies";

import { createExternalStore } from "../lib/external-store";
import type { NoteState, Settled } from "./page/page-host";

type NotePageLife =
  | { readonly kind: "reading" }
  | { readonly kind: "editing" }
  | { readonly kind: "asking"; readonly ask: number; readonly for: "leave" | "release" }
  | { readonly kind: "leaving" }
  | { readonly kind: "released" };

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
  readonly leave: (go: () => void, confirm: (discard: () => void) => void) => void;
}

const stay = (page: NotePage) => ({ effect: null, page }) satisfies LifeStep;

const to = (page: NotePage, life: NotePageLife, effect: LifeEffect = null) =>
  ({
    effect,
    page: { ...page, life },
  }) satisfies LifeStep;

const asking = (page: NotePage, purpose: "leave" | "release") =>
  ({
    effect: "ask",
    page: {
      ...page,
      asked: page.asked + 1,
      life: { ask: page.asked + 1, for: purpose, kind: "asking" },
    },
  }) satisfies LifeStep;

const drawn = (page: NotePage, editing: boolean) => {
  if (editing) {
    return page.deep ? asking(page, "release") : to(page, { kind: "editing" });
  }

  return to(page, { kind: page.deep ? "released" : "reading" });
};

const settled = (page: NotePage, purpose: "leave" | "release", holds: boolean) => {
  if (holds) {
    return purpose === "leave"
      ? to(page, { kind: "leaving" }, "leave")
      : to(page, { kind: "released" });
  }

  return to(page, { kind: "editing" }, purpose === "leave" ? "confirm" : null);
};

const placedAfter = (page: NotePage, deep: boolean) => {
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

    default: {
      throw new Error(`unexpected ${String(life satisfies never)}`);
    }
  }
};

const lifeAfter = (page: NotePage, event: LifeEvent) => {
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

    default: {
      throw new Error(`unexpected ${String(event satisfies never)}`);
    }
  }
};

export const notePageLife = ({ deep }: { readonly deep: boolean }) => {
  const store = createExternalStore<NotePage>({
    asked: 0,
    deep,
    life: { kind: deep ? "released" : "reading" },
  });

  let leaving: { readonly go: () => void; readonly confirm: (discard: () => void) => void } | null =
    null;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = (effect: LifeEffect, again: (event: LifeEvent) => void) => {
    switch (effect) {
      case "ask": {
        const ask = store.get().asked;
        timer = setTimeout(() => {
          again({ ask, holds: false, kind: "answered" });
        }, HOLDS_ANSWER_MS);
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

      default: {
        throw new Error(`unexpected ${String(effect satisfies never)}`);
      }
    }
  };

  const step = (event: LifeEvent) => {
    const page = store.get();
    const { effect, page: next } = lifeAfter(page, event);

    if (page.life.kind === "asking" && next.life.kind !== "asking") {
      clearTimeout(timer);
    }

    if (next !== page) {
      store.set(next);
    }

    run(effect, step);
  };

  return {
    answer: ({ ask, holds }) => {
      step({ ask, holds, kind: "answered" });
    },
    get: store.get,
    leave: (go, confirm) => {
      const { life } = store.get();

      if (life.kind !== "asking" || life.for !== "leave") {
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
    subscribe: store.subscribe,
  } satisfies NotePageLifeStore;
};
