import type { CallOutcome } from "@repo/contract/rpc/call-outcome";
import { deferred } from "@repo/contract/deferred";
import { describe, expect, it, test } from "vitest";
import { z } from "zod";

import { memoryKv } from "./test-support/memory-kv.test-utils";
import type { MemoryKv } from "./test-support/memory-kv.test-utils";
import { oneAtATime, savesWaiting, waitingSaves } from "./waiting-saves";
import type { WaitingSave } from "./waiting-saves";

const NOW = 1_700_000_000_000;
const FIRST = "0190a000-0000-7000-8000-0000000000a1";
const SECOND = "0190a000-0000-7000-8000-0000000000a2";
const THIRD = "0190a000-0000-7000-8000-0000000000a3";

const pageSchema = z.object({ url: z.string() });

type Page = z.infer<typeof pageSchema>;

const queueOver = (storage: MemoryKv = memoryKv()) => ({
  saves: waitingSaves({
    payload: pageSchema,
    prefix: "save:",
    sameSave: (a, b) => a.url === b.url,
    storage,
  }),
  storage,
});

const stampOf = (opId: string) => ({
  id: opId.replace(/a(?=\d$)/u, "1"),
  opId,
  savedAt: NOW + Number(opId.at(-1)) * 1000,
});

const pageOf = (opId: string) =>
  ({ url: `https://example.test/${opId.at(-1) ?? ""}` }) satisfies Page;

const LANDED = { answer: null, kind: "landed" } as const;
const FULL = { code: "QUOTA", kind: "refused", message: "Your library is full." } as const;

const sending = (answers: Readonly<Record<string, CallOutcome<null> | { kind: "skipped" }>>) => {
  const sent: string[] = [];

  return {
    send: async (save: WaitingSave<Page>) => {
      sent.push(save.opId);

      return answers[save.opId] ?? LANDED;
    },
    sent,
  };
};

describe("a waiting save", () => {
  it("is kept under one key before any call, and listed oldest first", async () => {
    const { saves, storage } = queueOver();
    await saves.keep(stampOf(SECOND), pageOf(SECOND));
    const first = await saves.keep(stampOf(FIRST), pageOf(FIRST));

    expect(first).toStrictEqual({ ...stampOf(FIRST), payload: pageOf(FIRST), refused: null });
    expect([...storage.held.keys()].toSorted()).toStrictEqual([`save:${FIRST}`, `save:${SECOND}`]);
    const listed = await saves.list();
    expect(listed.map((save) => save.opId)).toStrictEqual([FIRST, SECOND]);
  });

  it("is read from the store at every step, so a queue made later holds what an earlier one kept", async () => {
    const { saves, storage } = queueOver();
    await saves.keep(stampOf(FIRST), pageOf(FIRST));

    const relaunched = queueOver(storage).saves;
    const { send, sent } = sending({});
    await relaunched.pass(send);
    expect(sent).toStrictEqual([FIRST]);
    await expect(saves.list()).resolves.toStrictEqual([]);
  });

  it("goes once it lands, and the pass goes on to the next", async () => {
    const { saves, storage } = queueOver();
    await saves.keep(stampOf(FIRST), pageOf(FIRST));
    await saves.keep(stampOf(SECOND), pageOf(SECOND));
    const { send, sent } = sending({});
    await saves.pass(send);
    expect(sent).toStrictEqual([FIRST, SECOND]);
    expect([...storage.held.keys()]).toStrictEqual([]);
  });

  it.each(["connection", "sign-in", "update"] as const)(
    "stays as it was kept while it waits for %s, and the rest wait with it",
    async (waitsFor) => {
      const { saves } = queueOver();
      const first = await saves.keep(stampOf(FIRST), pageOf(FIRST));
      const second = await saves.keep(stampOf(SECOND), pageOf(SECOND));
      const { send, sent } = sending({ [FIRST]: { for: waitsFor, kind: "wait" } });
      await saves.pass(send);
      expect(sent).toStrictEqual([FIRST]);
      await expect(saves.list()).resolves.toStrictEqual([first, second]);
    },
  );

  it("is parked with the library's words when no resend can land it, and no pass sends it until it is tried again", async () => {
    const { saves } = queueOver();
    const first = await saves.keep(stampOf(FIRST), pageOf(FIRST));
    await saves.keep(stampOf(SECOND), pageOf(SECOND));
    const refusing = sending({ [FIRST]: FULL });
    await saves.pass(refusing.send);
    expect(refusing.sent).toStrictEqual([FIRST, SECOND]);
    await expect(saves.list()).resolves.toStrictEqual([{ ...first, refused: FULL.message }]);

    const later = sending({});
    await saves.pass(later.send);
    expect(later.sent).toStrictEqual([]);

    await saves.retry(FIRST);
    await expect(saves.list()).resolves.toStrictEqual([first]);
    await saves.pass(later.send);
    expect(later.sent).toStrictEqual([FIRST]);
    await expect(saves.list()).resolves.toStrictEqual([]);
  });

  it("is let go for good when the person says so", async () => {
    const { saves, storage } = queueOver();
    await saves.keep(stampOf(FIRST), pageOf(FIRST));
    await saves.settle(FIRST, FULL);
    await saves.discard(FIRST);
    expect([...storage.held.keys()]).toStrictEqual([]);
  });

  it("goes with its deleted account, which stops the pass", async () => {
    const { saves } = queueOver();
    await saves.keep(stampOf(FIRST), pageOf(FIRST));
    const second = await saves.keep(stampOf(SECOND), pageOf(SECOND));
    const { send, sent } = sending({ [FIRST]: { kind: "gone" } });
    await saves.pass(send);
    expect(sent).toStrictEqual([FIRST]);
    await expect(saves.list()).resolves.toStrictEqual([second]);
  });

  it("is left as it is by a pass that skips it, which goes on", async () => {
    const { saves } = queueOver();
    const first = await saves.keep(stampOf(FIRST), pageOf(FIRST));
    await saves.keep(stampOf(SECOND), pageOf(SECOND));
    const { send, sent } = sending({ [FIRST]: { kind: "skipped" } });
    await saves.pass(send);
    expect(sent).toStrictEqual([FIRST, SECOND]);
    await expect(saves.list()).resolves.toStrictEqual([first]);
  });

  it("is settled by a try made outside a pass as a pass settles it", async () => {
    const { saves } = queueOver();
    const first = await saves.keep(stampOf(FIRST), pageOf(FIRST));
    await saves.settle(FIRST, { for: "connection", kind: "wait" });
    await expect(saves.list()).resolves.toStrictEqual([first]);
    await saves.settle(FIRST, FULL);
    await expect(saves.list()).resolves.toStrictEqual([{ ...first, refused: FULL.message }]);
    await saves.settle(FIRST, LANDED);
    await expect(saves.list()).resolves.toStrictEqual([]);
  });

  it("stays gone when it was let go while its call was on its way, whatever the call answered", async () => {
    const { saves, storage } = queueOver();
    await saves.keep(stampOf(FIRST), pageOf(FIRST));
    const answer = deferred();

    const passing = saves.pass(async () => {
      await answer.promise;

      return FULL;
    });

    await saves.clear();
    answer.resolve();
    await passing;
    expect([...storage.held.keys()]).toStrictEqual([]);
  });

  it("is not sent by a pass under way once it was let go", async () => {
    const { saves } = queueOver();
    await saves.keep(stampOf(FIRST), pageOf(FIRST));
    await saves.keep(stampOf(SECOND), pageOf(SECOND));
    const sent: string[] = [];
    await saves.pass(async (save) => {
      sent.push(save.opId);
      await saves.clear();

      return LANDED;
    });
    expect(sent).toStrictEqual([FIRST]);
  });

  it("is dropped, never sent, when its record is not one this build reads", async () => {
    const { saves, storage } = queueOver();
    await storage.setItem("save:broken", JSON.stringify({ payload: { url: 7 } }));
    await storage.setItem("save:torn", "{");
    await storage.setItem("other", "kept");
    const { send, sent } = sending({});
    await saves.pass(send);
    expect(sent).toStrictEqual([]);
    expect([...storage.held.keys()]).toStrictEqual(["other"]);
  });

  it("goes where the host names it, or with every other", async () => {
    const { saves, storage } = queueOver();
    await saves.keep(stampOf(FIRST), pageOf(FIRST));
    const second = await saves.keep(stampOf(SECOND), pageOf(SECOND));
    await storage.setItem("other", "kept");
    await saves.clear((save) => save.opId === FIRST);
    await expect(saves.list()).resolves.toStrictEqual([second]);
    await saves.clear();
    expect([...storage.held.keys()]).toStrictEqual(["other"]);
  });

  it("tells whoever listens what is kept after each change", async () => {
    const { saves } = queueOver();
    const told: string[][] = [];

    const stop = saves.onChange((kept) => {
      told.push(kept.map((save) => `${save.opId.at(-1) ?? ""}${save.refused === null ? "" : "!"}`));
    });

    await saves.keep(stampOf(FIRST), pageOf(FIRST));
    await saves.keep(stampOf(SECOND), pageOf(SECOND));
    await saves.pass(sending({ [FIRST]: FULL }).send);
    await saves.discard(FIRST);
    stop();
    await saves.keep(stampOf(THIRD), pageOf(THIRD));
    expect(told).toStrictEqual([["1"], ["1", "2"], ["1!", "2"], ["1!"], []]);
  });

  it("takes the place of one the same that waits, so a page saved again waits once, and leaves one parked", async () => {
    const { saves } = queueOver();
    const page = pageOf(FIRST);
    await saves.keep(stampOf(FIRST), page);
    await saves.settle(FIRST, FULL);
    await saves.keep(stampOf(SECOND), page);
    const third = await saves.keep(stampOf(THIRD), page);
    await expect(saves.list()).resolves.toStrictEqual([
      { ...stampOf(FIRST), payload: page, refused: FULL.message },
      third,
    ]);
  });

  it("joins a refusal of one the same already parked, which keeps its op id and takes the newest words", async () => {
    const { saves } = queueOver();
    const page = pageOf(FIRST);
    const parked = await saves.keep(stampOf(FIRST), page);
    await saves.settle(FIRST, FULL);
    await saves.keep(stampOf(SECOND), page);
    await saves.keep(stampOf(THIRD), pageOf(THIRD));
    const again = { ...FULL, message: "Your library is still full." };
    await saves.pass(sending({ [SECOND]: again, [THIRD]: FULL }).send);
    await expect(saves.list()).resolves.toStrictEqual([
      { ...parked, refused: again.message },
      { ...stampOf(THIRD), payload: pageOf(THIRD), refused: FULL.message },
    ]);
  });

  it("says a store that would not write, and keeps nothing", async () => {
    const { saves, storage } = queueOver();
    storage.failWrites(true);
    await expect(saves.keep(stampOf(FIRST), pageOf(FIRST))).rejects.toThrow(/full/u);
    storage.failWrites(false);
    await expect(saves.list()).resolves.toStrictEqual([]);
  });
});

test("counts the saves that wait in one phrase for every device", () => {
  expect([1, 2].map(savesWaiting)).toStrictEqual(["1 save waiting", "2 saves waiting"]);
});

describe(oneAtATime, () => {
  it("runs one pass at a time, and exactly one more for every ask made while one ran", async () => {
    const holds = [deferred(), deferred()];
    const began: string[] = [];

    const pass = oneAtATime(async (asker: string) => {
      began.push(asker);
      await holds[began.length - 1]?.promise;
    });

    const asks = [pass("first"), pass("second"), pass("third"), pass("fourth")];
    expect(began).toStrictEqual(["first"]);
    holds[0]?.resolve();
    await expect.poll(() => began).toStrictEqual(["first", "first"]);
    holds[1]?.resolve();
    await Promise.all(asks);
    expect(began).toHaveLength(2);
  });

  it("starts over at the next ask after a pass that failed", async () => {
    let fails = true;
    let ran = 0;

    const pass = oneAtATime(async () => {
      ran += 1;

      if (fails) {
        throw new Error("the store would not open");
      }
    });

    await expect(pass()).rejects.toThrow(/would not open/u);
    fails = false;
    await pass();
    expect(ran).toBe(2);
  });
});
