// Undo over Postgres: the built-in agent's turns written through the rows as its principal calls
// them, and taken back as the person's tab asks; its edits of a body are `../body/body-undo.test.ts`'s.

import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { paragraph } from "@repo/contract/test-support/library-items";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { libraryAs, personalLibrary } from "../test-support/library-fixture";
import { sealTurnSet } from "./library-change-sets";
import { mintLibraryId } from "./library-ids";

// an undo's answer when nothing of what it named is left to take back
const NOTHING_LEFT = { kept: [], next: null, refused: [], reverted: [] };

const blocksOf = (lines: readonly string[]): BodyBlock[] =>
  lines.map((text) => ({ block: paragraph(randomUUID(), text), section: "note" }));

const noteOf = (lines: readonly string[], title = "") => ({
  blocks: blocksOf(lines),
  folderId: null,
  id: mintLibraryId(Date.now()),
  savedAt: Date.now(),
  tags: [],
  title,
});

// one turn of one thread, its writes through the rows
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

const codeOf = async (call: Promise<unknown>): Promise<string> => {
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
    // a turn still open is not yet one to undo, and an undo of it takes nothing back
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual(NOTHING_LEFT);
    await turn.end();
    // an ended turn takes no more writes
    expect(await codeOf(turn.library.items.create(noteOf(["Late."])))).toBe("FORBIDDEN");
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      reverted: [made.id],
    });
    const { fields } = await library.items.row({ id: made.id });
    expect(fields.deletedAt).not.toBeNull();
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
    // a second press, or another device's, finds nothing left, and is refused nothing
    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual(NOTHING_LEFT);
    await expect(library.agent.undo({ threadId })).resolves.toStrictEqual(NOTHING_LEFT);
    // one turn, or the conversation from a turn down, never both
    expect(await codeOf(library.agent.undo({ before: 2, threadId, turn: 1 }))).toBe("BAD_REQUEST");
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
