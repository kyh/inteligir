import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { db } from "@repo/db/drizzle-client";
import { itemSearch } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { libraryAs, personalLibrary } from "../test-support/library.fixture";
import { sealTurnSet } from "./library-change-sets";
import { mintLibraryId } from "./library-ids";

const NOTHING_LEFT = { kept: [], next: null, refused: [], reverted: [] };

const line = (text: string) =>
  ({
    block: paragraph(randomUUID(), text),
    section: "note",
  }) satisfies BodyBlock;

const noteOf = (lines: readonly string[], title = "") => ({
  blocks: lines.map((text) => line(text)),
  parentId: null,
  id: mintLibraryId(Date.now()),
  savedAt: Date.now(),
  tags: [],
  title,
});

const turnOf = (accountId: string, threadId: string, turn: number) => {
  const library = libraryAs({ accountId, actor: { kind: "agent", threadId, turn } });

  return {
    edit: async (id: string, oldText: string, newText: string) =>
      await library.items.edit({ edits: [{ newText, oldText }], id }),
    end: async () => {
      await sealTurnSet(db, accountId, { threadId, turn }, Date.now());
    },
    library,
  };
};

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const textsOf = async (library: Library, id: string) => {
  const { blocks } = await library.items.get({ id });

  return blocks.map(({ block }) =>
    "children" in block
      ? block.children.map((child) => ("text" in child ? child.text : "")).join("")
      : "",
  );
};

const searchTextOf = async (accountId: string, id: string) => {
  const [row] = await db
    .select({ text: itemSearch.text })
    .from(itemSearch)
    .where(and(eq(itemSearch.accountId, accountId), eq(itemSearch.itemId, id)));

  return row?.text;
};

dbSuite("Undo of the built-in agent's edits of a note", () => {
  it("takes a turn's edits back, fields and body together, its search text with them", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf(["Before."], "Plans");
    await library.items.create(made);
    const threadId = randomUUID();
    const turn = turnOf(accountId, threadId, 1);
    await turn.library.items.organize({
      addTags: ["agent"],
      ids: [made.id],
      title: "Agent's plans",
    });
    await turn.edit(made.id, "Before.", "The agent's words.");
    await turn.edit(made.id, "The agent's words.", "The agent's second words.");
    await turn.end();
    await expect(searchTextOf(accountId, made.id)).resolves.toBe("The agent's second words.");

    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      reverted: [made.id],
    });
    const { blocks, fields } = await library.items.get({ id: made.id });
    expect(fields).toMatchObject({ tags: [], title: "Plans" });
    expect(blocks).toStrictEqual(made.blocks);
    await expect(searchTextOf(accountId, made.id)).resolves.toBe("Before.");
  });

  it("restores the body as the person last saved it before the turn", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf(["Draft."]);
    await library.items.create(made);
    const saved = [...made.blocks, line("The person's second line.")];
    await library.items.saveBody({ baseVersion: 1, blocks: saved, id: made.id });
    const threadId = randomUUID();
    const turn = turnOf(accountId, threadId, 1);
    await turn.edit(made.id, "Draft.", "The agent's draft.");
    await turn.end();

    await library.agent.undo({ threadId, turn: 1 });
    await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
      blocks: saved,
      bodyVersion: 4,
    });
  });

  it("keeps a note the person saved since whole, and names it", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf(["Before."], "Plans");
    await library.items.create(made);
    const threadId = randomUUID();
    const turn = turnOf(accountId, threadId, 1);
    await turn.library.items.organize({ ids: [made.id], title: "Agent's plans" });
    await turn.edit(made.id, "Before.", "The agent's words.");
    await turn.end();
    const { blocks, bodyVersion } = await library.items.get({ id: made.id });
    await library.items.saveBody({
      baseVersion: bodyVersion,
      blocks: [...blocks, line("The person's words since.")],
      id: made.id,
    });

    await expect(library.agent.undo({ threadId, turn: 1 })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      kept: [made.id],
    });
    await expect(textsOf(library, made.id)).resolves.toStrictEqual([
      "The agent's words.",
      "The person's words since.",
    ]);
    await expect(library.items.row({ id: made.id })).resolves.toMatchObject({
      fields: { title: "Agent's plans" },
    });
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
  });

  it("takes a conversation back newest first, each body through the turns that edited it", async () => {
    const { accountId, library } = await personalLibrary();
    const held = noteOf(["First."]);
    await library.items.create(held);
    const threadId = randomUUID();
    const first = turnOf(accountId, threadId, 1);
    const made = noteOf(["The agent's note."]);
    await first.library.items.create(made);
    await first.edit(held.id, "First.", "Second.");
    await first.end();
    const second = turnOf(accountId, threadId, 2);
    await second.edit(held.id, "Second.", "Third.");
    await second.edit(made.id, "The agent's note.", "The agent's note, written again.");
    await second.end();
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1, 2] });

    await expect(library.agent.undo({ threadId })).resolves.toStrictEqual({
      ...NOTHING_LEFT,
      reverted: [held.id, made.id].toSorted(),
    });
    await expect(textsOf(library, held.id)).resolves.toStrictEqual(["First."]);
    const { fields } = await library.items.row({ id: made.id });
    expect(fields.deletedAt).not.toBeNull();
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
  });
});
