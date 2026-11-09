import { describe, expect, it } from "vitest";

import { createLeaveGuard } from "./leave-guard";

// a leave as the browser makes it: the page asks first when the event comes back prevented
const leaving = (target: EventTarget): "asks" | "goes" =>
  target.dispatchEvent(new Event("beforeunload", { cancelable: true })) ? "goes" : "asks";

// a holder whose state the test sets, telling the guard each time it moves
const holder = (initial: boolean) => {
  let holds = initial;
  let moved: (() => void) | null = null;
  return {
    holding: () => holds,
    onMove: (listener: () => void) => {
      moved = listener;
      return () => {
        moved = null;
      };
    },
    set: (next: boolean) => {
      holds = next;
      moved?.();
    },
  };
};

describe("asking before the tab leaves", () => {
  it("asks only while a holder holds something, and lets the page go once it is sent", () => {
    const target = new EventTarget();
    const guard = createLeaveGuard(target);
    const item = holder(false);
    guard.hold(item);
    expect(leaving(target)).toBe("goes");
    item.set(true);
    expect(leaving(target)).toBe("asks");
    item.set(false);
    expect(leaving(target)).toBe("goes");
  });

  it("asks while any of its holders holds, and forgets a holder released", () => {
    const target = new EventTarget();
    const guard = createLeaveGuard(target);
    const settings = holder(false);
    const editor = holder(true);
    guard.hold(settings);
    const release = guard.hold(editor);
    expect(leaving(target)).toBe("asks");
    release();
    expect(leaving(target)).toBe("goes");
    // a released holder's moves no longer reach the guard
    editor.set(true);
    expect(leaving(target)).toBe("goes");
  });

  it("lets the page go for good once it leaves on purpose", () => {
    const target = new EventTarget();
    const guard = createLeaveGuard(target);
    const item = holder(true);
    guard.hold(item);
    guard.drop();
    expect(leaving(target)).toBe("goes");
    item.set(true);
    expect(leaving(target)).toBe("goes");
  });
});
