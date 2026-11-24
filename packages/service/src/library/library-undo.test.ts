import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { openThread } from "../agent/agent-threads";
import { libraryAs, personalLibrary, seedItem } from "../test-support/library.fixture";
import { sealTurnSet } from "./turn-sets";
import { mintLibraryId } from "./library-ids";

const NOTHING_LEFT = { kept: [], next: null, refused: [], reverted: [] };

const blocksOf: (lines: readonly string[]) => BodyBlock[] = (lines: readonly string[]) =>
  lines.map((text) => ({ block: paragraph(randomUUID(), text), section: "note" }));

const noteOf = (lines: readonly string[], title = "") => ({
  blocks: blocksOf(lines),
  parentId: null,
  id: mintLibraryId(Date.now()),
  savedAt: Date.now(),
  tags: [],
  title,
});

const turnOf = (accountId: string, threadId: string, turn: number) => {
  const actor = { kind: "agent", threadId, turn } as const;

  return {
    end: async () => {
      await sealTurnSet(db, accountId, { threadId, turn }, Date.now());
    },
    library: libraryAs({ accountId, actor }),
    writer: { accountId, actor },
  };
};

const codeOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (isOrpcError(error)) {
      return error.code;
    }

    throw error;
  }

  throw new Error("the call landed what the test expected it to refuse");
};

dbSuite("Undo of the built-in agent's turns", () => {
  it("names the turns Undo can take back, the person's writes in none, and undoes an ended turn once", async () => {
    const { accountId, library } = await personalLibrary();
    await library.items.create(noteOf(["The person's."]));
    const threadId = randomUUID();
    const turn = turnOf(accountId, threadId, 1);
    const made = noteOf(["Before."]);
    await turn.library.items.create(made);
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual(NOTHING_LEFT);
    await turn.end();
    expect(await codeOf(turn.library.items.create(noteOf(["Late."])))).toBe("FORBIDDEN");
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      reverted: [made.id],
    });
    const { fields } = await library.items.row({ id: made.id });
    expect(fields.deletedAt).not.toBeNull();
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual(NOTHING_LEFT);
    await expect(library.agent.undo({ threadId })).resolves.toStrictEqual(NOTHING_LEFT);
    expect(await codeOf(library.agent.undo({ before: 2, threadId, turn: 1 }))).toBe("BAD_REQUEST");
  });

  it("names the thread to every device once emptying Deleted takes its turn's last change", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf(["The person's."]);
    await library.items.create(made);
    const threadId = randomUUID();
    await openThread(accountId, { id: threadId, now: Date.now(), title: "Tidy up" });
    const turn = turnOf(accountId, threadId, 1);
    await turn.library.items.delete({ ids: [made.id] });
    await turn.end();
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
    const { head } = await library.changes({});
    await library.items.purge({ ids: [made.id] });
    const { moved } = await library.changes({ after: head });
    expect(moved?.threads).toStrictEqual([threadId]);
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
  });

  it("takes back a conversation of more changes than one undo lands a lot at a time, whole turns each", async () => {
    const { accountId, library } = await personalLibrary();
    const perTurn = BULK_ITEMS_MAX / 2 + 1;
    const ids: string[] = [];

    for (let at = 0; at < 2 * perTurn; at += 1) {
      const seeded = await seedItem(accountId, {
        fields: noteFixture({ title: `Note ${String(at)}` }),
      });

      ids.push(seeded.id);
    }

    const [older, newer] = [ids.slice(0, perTurn), ids.slice(perTurn)];
    const threadId = randomUUID();

    for (const [at, lot] of [older, newer].entries()) {
      const turn = turnOf(accountId, threadId, at + 1);
      await turn.library.items.delete({ ids: lot });
      await turn.end();
    }

    await expect(library.agent.undo({ threadId })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      next: 2,
      reverted: newer.toSorted(),
    });
    await expect(library.agent.undo({ before: 2, threadId })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      reverted: older.toSorted(),
    });
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
  });

  it("takes back a turn of more changes than a lot holds a write at a time, in one call", async () => {
    const { accountId, library } = await personalLibrary();
    const ids: string[] = [];

    for (let at = 0; at < 2 * BULK_ITEMS_MAX + 1; at += 1) {
      const seeded = await seedItem(accountId, {
        fields: noteFixture({ title: `Note ${String(at)}` }),
      });

      ids.push(seeded.id);
    }

    const threadId = randomUUID();
    const turn = turnOf(accountId, threadId, 1);

    for (let at = 0; at < ids.length; at += BULK_ITEMS_MAX) {
      await turn.library.items.delete({ ids: ids.slice(at, at + BULK_ITEMS_MAX) });
    }

    await turn.end();

    const sorted = ids.toSorted();
    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      reverted: sorted,
    });

    const seqs = await Promise.all(
      [0, BULK_ITEMS_MAX - 1, BULK_ITEMS_MAX, 2 * BULK_ITEMS_MAX].map(async (at) => {
        const { seq } = await library.items.row({ id: sorted[at] ?? "" });

        return seq;
      }),
    );

    expect(new Set(seqs).size).toBe(3);
    expect(seqs).toStrictEqual(seqs.toSorted((a, b) => a - b));
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
  });

  it("answers an undo another item's link holds back in words that say so", async () => {
    const { accountId, library } = await personalLibrary();
    const url = "https://pages.example/held";
    const { item } = await library.items.saveLink({ url });
    const turn = turnOf(accountId, randomUUID(), 1);
    await turn.library.items.delete({ ids: [item.id] });
    await turn.end();
    await library.items.saveLink({ url });
    await expect(
      library.agent.undo({ threadId: turn.writer.actor.threadId, turn: 1 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      defined: true,
      message: "Another item in your library already holds this link.",
    });
  });
});
