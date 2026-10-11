import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { BACKGROUND_READ_SLOTS, createReadSlots, READ_SLOTS } from "../read-slots";
import type { ReadLane, ReadSlots } from "../read-slots";

// an open that answers only when the test says so, and says when it began
const heldOpen = (slots: ReadSlots, lane: ReadLane, log: string[], name: string) => {
  const answer = Promise.withResolvers<string>();
  const done = slots.hold(lane, async () => {
    log.push(name);
    return await answer.promise;
  });
  return { done, release: () => answer.resolve(name) };
};

const settle = async (): Promise<void> => {
  await nextTurn();
};

describe("the vault's read slots", () => {
  it("open no more background reads than their share, and keep the last slot for the window", async () => {
    const slots = createReadSlots();
    const opened: string[] = [];
    const background = Array.from({ length: BACKGROUND_READ_SLOTS + 2 }, (_, index) =>
      heldOpen(slots, "background", opened, `background ${String(index)}`),
    );
    await settle();
    expect(opened).toEqual(["background 0", "background 1"]);

    const window = heldOpen(slots, "foreground", opened, "window");
    await settle();
    expect(opened).toEqual(["background 0", "background 1", "window"]);
    expect(opened).toHaveLength(READ_SLOTS);

    const queued = heldOpen(slots, "foreground", opened, "window again");
    await settle();
    expect(opened).toHaveLength(READ_SLOTS);

    background[0]?.release();
    await settle();
    expect(opened.at(-1)).toBe("window again");

    window.release();
    queued.release();
    await settle();
    expect(opened.at(-1)).toBe("background 2");

    for (const read of background.slice(1)) {
      read.release();
    }
    await Promise.all([
      ...background.map(async (read) => await read.done),
      window.done,
      queued.done,
    ]);
    expect(opened).toHaveLength(BACKGROUND_READ_SLOTS + 4);
  });

  it("frees the slot of a read that fails", async () => {
    const slots = createReadSlots();
    const failing = Array.from({ length: READ_SLOTS }, async () => {
      await slots.hold("foreground", async () => {
        await settle();
        throw new Error("EIO");
      });
    });
    const behind = slots.hold("foreground", async () => await Promise.resolve("answered"));

    const outcomes = await Promise.allSettled(failing);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(
      Array.from({ length: READ_SLOTS }, () => "rejected"),
    );
    expect(await behind).toBe("answered");
  });
});
