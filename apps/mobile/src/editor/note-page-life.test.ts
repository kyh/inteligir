import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notePageLife, SETTLE_ANSWER_MS } from "./note-page-life";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// a page's life, with each leave made and each time the person was asked
const lifeOver = (deep = false) => {
  const life = notePageLife({ deep });
  const heard = { asked: 0, left: 0 };
  let discard: (() => void) | null = null;
  const back = (): void => {
    life.leave(
      () => {
        heard.left += 1;
      },
      (leaveWithout) => {
        heard.asked += 1;
        discard = leaveWithout;
      },
    );
  };
  return {
    back,
    discard: () => {
      if (discard === null) {
        throw new Error("nobody was asked to leave without the edits");
      }
      discard();
    },
    heard,
    life,
    kind: () => life.get().life.kind,
    settle: () => life.get().asked,
  };
};

describe("a note page's life", () => {
  it("lets a leave go at once while the page reads, and asks the page first while it edits", () => {
    const reading = lifeOver();
    reading.life.report("reading");
    reading.back();
    expect(reading.heard).toStrictEqual({ asked: 0, left: 1 });
    expect(reading.settle()).toBe(0);

    const editing = lifeOver();
    editing.life.report("editing");
    editing.back();
    expect(editing.kind()).toBe("asking");
    expect(editing.settle()).toBe(1);
    expect(editing.heard.left).toBe(0);
    editing.life.answer({ ask: 1, holds: true });
    expect(editing.heard).toStrictEqual({ asked: 0, left: 1 });
    expect(editing.kind()).toBe("leaving");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks once and leaves once however many times Back is pressed", () => {
    const { back, heard, life, settle } = lifeOver();
    life.report("editing");
    back();
    back();
    expect(settle()).toBe(1);
    life.answer({ ask: 1, holds: true });
    back();
    life.answer({ ask: 1, holds: true });
    expect(heard).toStrictEqual({ asked: 0, left: 1 });
  });

  it("asks the person when the note does not hold, or the page does not answer in time, and the page again on the next Back", () => {
    const { back, heard, kind, life, settle } = lifeOver();
    life.report("editing");
    back();
    life.answer({ ask: 1, holds: false });
    expect(heard).toStrictEqual({ asked: 1, left: 0 });
    expect(kind()).toBe("editing");

    back();
    expect(settle()).toBe(2);
    vi.advanceTimersByTime(SETTLE_ANSWER_MS - 1);
    expect(heard.asked).toBe(1);
    vi.advanceTimersByTime(1);
    expect(heard).toStrictEqual({ asked: 2, left: 0 });

    back();
    expect(settle()).toBe(3);
    life.answer({ ask: 3, holds: true });
    expect(heard).toStrictEqual({ asked: 2, left: 1 });

    const discarded = lifeOver();
    discarded.life.report("editing");
    discarded.back();
    discarded.life.answer({ ask: 1, holds: false });
    discarded.discard();
    expect(discarded.heard).toStrictEqual({ asked: 1, left: 1 });
    expect(discarded.kind()).toBe("leaving");
  });

  it("acts on no answer with no ask outstanding, nor on one to an earlier ask", () => {
    const { back, heard, kind, life } = lifeOver();
    life.report("editing");
    life.answer({ ask: 1, holds: true });
    expect(kind()).toBe("editing");

    back();
    vi.advanceTimersByTime(SETTLE_ANSWER_MS);
    back();
    life.answer({ ask: 1, holds: true });
    expect(kind()).toBe("asking");
    expect(heard).toStrictEqual({ asked: 1, left: 0 });
  });

  it("settles an ask as held once the page says its note no longer takes edits from here", () => {
    const { back, heard, life } = lifeOver();
    life.report("editing");
    back();
    life.report("reading");
    expect(heard).toStrictEqual({ asked: 0, left: 1 });
  });

  it("lets a deep page's web view go once the note holds, and draws it again on the way back", () => {
    const { kind, life, settle } = lifeOver();
    life.report("editing");
    life.place(true);
    expect(kind()).toBe("asking");
    life.answer({ ask: settle(), holds: true });
    expect(kind()).toBe("released");
    life.place(false);
    expect(kind()).toBe("reading");

    life.report("reading");
    life.place(true);
    expect(kind()).toBe("released");
  });

  it("asks a deep page again once the connection is back after its note did not hold", () => {
    const { kind, life, settle } = lifeOver();
    life.report("editing");
    life.place(true);
    vi.advanceTimersByTime(SETTLE_ANSWER_MS);
    expect(kind()).toBe("editing");
    life.reconnected();
    expect(settle()).toBe(2);
    life.answer({ ask: 2, holds: true });
    expect(kind()).toBe("released");
  });

  it("makes a release being asked the leave's ask when Back comes meanwhile", () => {
    const { back, heard, life, settle } = lifeOver();
    life.report("editing");
    life.place(true);
    back();
    expect(settle()).toBe(1);
    life.answer({ ask: 1, holds: true });
    expect(heard).toStrictEqual({ asked: 0, left: 1 });
  });

  it("keeps a page drawn whose release was being asked when it comes back up", () => {
    const { kind, life } = lifeOver();
    life.report("editing");
    life.place(true);
    life.place(false);
    expect(kind()).toBe("editing");
    life.answer({ ask: 1, holds: true });
    expect(kind()).toBe("editing");
  });
});
