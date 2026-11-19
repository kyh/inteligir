import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { libraryAs, personalLibrary } from "../test-support/library.fixture";
import { mintLibraryId } from "./library-ids";

type Library = ReturnType<typeof libraryAs>;

const untitledNote = (...texts: string[]) => ({
  blocks: texts.map(
    (text) =>
      ({
        block: paragraph(randomUUID(), text),
        section: "note",
      }) satisfies BodyBlock,
  ),
  folderId: null,
  id: mintLibraryId(Date.now()),
  savedAt: Date.now(),
  tags: [],
  title: "",
});

const agentOf = (accountId: string) =>
  libraryAs({ accountId, actor: { kind: "agent", threadId: randomUUID(), turn: 1 } });

const linkedBy = async (library: Library, accountId: string, title: string) => {
  const hub = untitledNote("Links go here.");
  await library.items.create(hub);
  await agentOf(accountId).items.edit({
    edits: [{ newText: `See [[${title}]].`, oldText: "Links go here." }],
    id: hub.id,
  });
  const { blocks } = await library.items.get({ id: hub.id });
  const [first] = blocks;

  return first !== undefined && "children" in first.block ? first.block.children : [];
};

const mention = (itemId: string, value: string) => ({
  children: [{ text: "" }],
  key: itemId,
  type: "mention",
  value,
});

dbSuite("a [[Title]] written from outside the editor", () => {
  it("reaches a link saved with no title by the name of its address that read_item answers", async () => {
    const { accountId, library } = await personalLibrary();

    const { item: link } = await library.items.saveLink({
      url: "https://example.com/notes/quarterly-review",
    });

    const { fields } = await library.items.read({ id: link.id });
    expect(link.fields.title).toBe("");
    expect(fields.title).not.toBe("");

    await expect(linkedBy(library, accountId, fields.title)).resolves.toStrictEqual([
      { text: "See " },
      mention(link.id, fields.title),
      { text: "." },
    ]);
  });

  it("reaches a note with no title by its first words, and follows them as they change", async () => {
    const { accountId, library } = await personalLibrary();
    const made = untitledNote("Garden plans for spring", "Tomatoes by the fence.");
    await library.items.create(made);
    const { fields } = await library.items.read({ id: made.id });
    expect(fields.title).toBe("Garden plans for spring");

    await expect(linkedBy(library, accountId, "garden plans for spring")).resolves.toStrictEqual([
      { text: "See " },
      mention(made.id, "Garden plans for spring"),
      { text: "." },
    ]);

    await agentOf(accountId).items.edit({
      edits: [{ newText: "Garden plans for autumn", oldText: "Garden plans for spring" }],
      id: made.id,
    });
    await expect(linkedBy(library, accountId, "Garden plans for spring")).resolves.toStrictEqual([
      { text: "See [[Garden plans for spring]]." },
    ]);
    await expect(linkedBy(library, accountId, "Garden plans for autumn")).resolves.toStrictEqual([
      { text: "See " },
      mention(made.id, "Garden plans for autumn"),
      { text: "." },
    ]);
  });

  it("stays text when two live items show the title it names", async () => {
    const { accountId, library } = await personalLibrary();
    const first = untitledNote("Weekly sync", "Monday's.");
    const second = untitledNote("Weekly sync", "Thursday's.");
    await library.items.create(first);
    await library.items.create(second);

    for (const { id } of [first, second]) {
      await expect(library.items.read({ id })).resolves.toMatchObject({
        fields: { title: "Weekly sync" },
      });
    }

    await expect(linkedBy(library, accountId, "Weekly sync")).resolves.toStrictEqual([
      { text: "See [[Weekly sync]]." },
    ]);
  });
});
