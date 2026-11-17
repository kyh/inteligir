// Undo over Postgres: the built-in agent's turns written through the rows as its principal calls
// them, a body through a landing of its own, and taken back as the person's tab asks.

import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { paragraph } from "@repo/contract/test-support/library-items";
import { db } from "@repo/db/drizzle-client";
import { itemSearch } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";

import { libraryAs, personalLibrary } from "../test-support/library-fixture";
import { sealTurnSet } from "./library-change-sets";
import { mintLibraryId } from "./library-ids";
import { landItem } from "./library-landing";
import { readItem } from "./library-rows";
import { writeLibrary } from "./library-store";
import type { LibraryWriter } from "./library-store";

// an undo's answer when nothing of what it named is left to take back
const NOTHING_LEFT = { kept: [], next: null, refused: [], reverted: [] };
const PERSON = { kind: "person" } as const;

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

// one turn of one thread, its writes through the rows and a body through a landing of its own
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

// the item's body as `lines`, written by `writer`
const writeBody = async (writer: LibraryWriter, id: string, lines: readonly string[]) => {
  const landed = await writeLibrary(
    writer,
    { answer: z.object({ id: z.string() }), opId: undefined },
    async (scope) => {
      const before = await readItem(scope.tx, scope.accountId, id);
      if (before === null) {
        throw new Error(`no item ${id}`);
      }
      const row = await landItem(scope, {
        before,
        body: blocksOf(lines),
        fields: before.fields,
        itemId: id,
      });
      return { id: row.id };
    },
  );
  expect(landed.ok).toBe(true);
};

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const textOf = async (library: Library, id: string): Promise<string[]> => {
  const { blocks } = await library.items.get({ id });
  return blocks.map(({ block }) =>
    "children" in block
      ? block.children.map((child) => ("text" in child ? child.text : "")).join("")
      : "",
  );
};

const searchTextOf = async (accountId: string, id: string): Promise<string | undefined> => {
  const [row] = await db
    .select({ text: itemSearch.text })
    .from(itemSearch)
    .where(and(eq(itemSearch.accountId, accountId), eq(itemSearch.itemId, id)));
  return row?.text;
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

  it("takes an agent turn's fields and body back together", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf(["Before."], "Plans");
    await library.items.create(made);
    const turn = turnOf(accountId, randomUUID(), 1);
    await turn.library.items.organize({
      addTags: ["agent"],
      ids: [made.id],
      title: "Agent's plans",
    });
    await writeBody(turn.writer, made.id, ["The agent's words."]);
    await writeBody(turn.writer, made.id, ["The agent's second words."]);
    await turn.end();
    await expect(searchTextOf(accountId, made.id)).resolves.toBe("The agent's second words.");

    await expect(
      library.agent.undo({ threadId: turn.writer.actor.threadId, turn: 1 }),
    ).resolves.toStrictEqual({ ...NOTHING_LEFT, reverted: [made.id] });
    const { blocks, fields } = await library.items.get({ id: made.id });
    expect(fields).toMatchObject({ tags: [], title: "Plans" });
    expect(blocks).toStrictEqual(made.blocks);
    await expect(searchTextOf(accountId, made.id)).resolves.toBe("Before.");
  });

  it("keeps an item whole, and names it, when its body was written since", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf(["Before."], "Plans");
    await library.items.create(made);
    const threadId = randomUUID();
    const turn = turnOf(accountId, threadId, 1);
    await turn.library.items.organize({ ids: [made.id], title: "Agent's plans" });
    await writeBody(turn.writer, made.id, ["The agent's words."]);
    await turn.end();
    await writeBody({ accountId, actor: PERSON }, made.id, ["The person's words since."]);

    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      kept: [made.id],
    });
    await expect(textOf(library, made.id)).resolves.toStrictEqual(["The person's words since."]);
    await expect(library.items.row({ id: made.id })).resolves.toMatchObject({
      fields: { title: "Agent's plans" },
    });
    // kept, so still the turn's to take back once the edit since goes
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
  });

  it("takes a conversation back newest first, each body through the turns that wrote it", async () => {
    const { accountId, library } = await personalLibrary();
    const held = noteOf(["First."]);
    await library.items.create(held);
    const threadId = randomUUID();
    const first = turnOf(accountId, threadId, 1);
    const made = noteOf(["The agent's note."]);
    await first.library.items.create(made);
    await writeBody(first.writer, held.id, ["Second."]);
    await first.end();
    const second = turnOf(accountId, threadId, 2);
    await writeBody(second.writer, held.id, ["Third."]);
    await writeBody(second.writer, made.id, ["The agent's note, written again."]);
    await second.end();
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1, 2] });

    await expect(library.agent.undo({ threadId })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      reverted: [held.id, made.id].toSorted(),
    });
    await expect(textOf(library, held.id)).resolves.toStrictEqual(["First."]);
    const { fields } = await library.items.row({ id: made.id });
    expect(fields.deletedAt).not.toBeNull();
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
  });
});
