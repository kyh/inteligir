import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { personalLibrary, seedItem } from "../test-support/library-fixture";

const SAVED_AT = Date.UTC(2026, 9, 1);

const lines = (...texts: string[]): BodyBlock[] =>
  texts.map((text, at) => ({ block: paragraph(`p${String(at)}`, text), section: "note" }));

// a paragraph naming an item by a page link, under the title the link was written with
const linkTo = (id: string, title: string, key: string): BodyBlock => {
  const block: LibraryBlock = {
    children: [
      { text: "See " },
      { children: [{ text: "" }], key: id, type: "mention", value: title },
      { text: "." },
    ],
    id: key,
    type: "p",
  };
  return { block, section: "note" };
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
  throw new Error("the call answered what the test expected it to refuse");
};

dbSuite("what the library answers a read of one item", () => {
  it("reads an item back as markdown a page of blocks at a time, and none another account holds", async () => {
    const { accountId, library } = await personalLibrary();
    const { id } = await seedItem(accountId, {
      blocks: lines("First line.", "Second line.", "Third line."),
      fields: noteFixture({ savedAt: SAVED_AT, tags: ["Reading"], title: "Three lines" }),
    });

    const whole = await library.items.read({ id });
    expect(whole.view).toStrictEqual({
      from: 0,
      markdown: "First line.\n\nSecond line.\n\nThird line.\n",
      to: 3,
      total: 3,
    });
    expect(whole.fields).toMatchObject({
      deletedAt: null,
      kind: "note",
      savedAt: new Date(SAVED_AT).toISOString(),
      tags: ["Reading"],
      title: "Three lines",
    });
    expect(whole.fields.aliases).toBeUndefined();

    const page = await library.items.read({ count: 1, from: 1, id });
    expect(page.view).toStrictEqual({ from: 1, markdown: "Second line.\n", to: 2, total: 3 });
    const detailed = await library.items.read({ id, responseFormat: "detailed" });
    expect(detailed.fields).toMatchObject({ aliases: [], properties: {} });
    await expect(codeOf(library.items.read({ id: randomUUID() }))).resolves.toBe("NOT_FOUND");
    const { library: stranger } = await personalLibrary();
    await expect(codeOf(stranger.items.read({ id }))).resolves.toBe("NOT_FOUND");
  });

  it("halves a page past what one read carries, one block alone its own page", async () => {
    const { accountId, library } = await personalLibrary();
    const long = "word ".repeat(1999).trim();
    const { id } = await seedItem(accountId, {
      blocks: lines(long, long, long, long),
      fields: noteFixture({ title: "Long" }),
    });
    const page = await library.items.read({ id });
    expect(page.view).toMatchObject({ from: 0, to: 1, total: 4 });
  });

  it("reads an item in Deleted with when it went there", async () => {
    const { accountId, library } = await personalLibrary();
    const { id } = await seedItem(accountId, {
      blocks: lines("Soon gone."),
      fields: noteFixture({ deletedAt: SAVED_AT + 1 }),
    });
    await expect(library.items.read({ id })).resolves.toMatchObject({
      fields: { deletedAt: new Date(SAVED_AT + 1).toISOString() },
    });
  });

  it("writes a page link under its item's title as it stands, and names the items linking in and out", async () => {
    const { accountId, library } = await personalLibrary();
    const renamed = await seedItem(accountId, { fields: noteFixture({ title: "New name" }) });
    const gone = await seedItem(accountId, {
      fields: noteFixture({ deletedAt: SAVED_AT, title: "Binned" }),
    });
    const page = await seedItem(accountId, {
      fields: noteFixture({ kind: "link", title: "", url: "https://example.com/a" }),
    });
    const id = randomUUID();
    const purged = randomUUID();
    await seedItem(accountId, {
      blocks: [
        linkTo(renamed.id, "Old name", "p1"),
        linkTo(gone.id, "Binned once", "p2"),
        linkTo(purged, "Purged", "p3"),
        linkTo(id, "Myself", "p4"),
      ],
      fields: noteFixture({ title: "Hub" }),
      id,
    });
    const into = await seedItem(accountId, {
      blocks: [linkTo(id, "Hub", "p1")],
      fields: noteFixture({ title: "Alpha" }),
    });
    const byAddress = await seedItem(accountId, {
      blocks: [
        {
          block: {
            children: [
              { children: [{ text: "the page" }], type: "a", url: "https://example.com/a" },
            ],
            id: "p1",
            type: "p",
          },
          section: "note",
        },
      ],
      fields: noteFixture({ title: "Beta" }),
    });

    const hub = await library.items.read({ id });
    expect(hub.view.markdown).toBe(
      `See [New name](mention:${renamed.id}).\n\nSee [Binned](mention:${gone.id}).\n\n` +
        `See [Purged](mention:${purged}).\n\nSee [Hub](mention:${id}).\n`,
    );
    expect(hub.links).toStrictEqual({
      in: [{ id: into.id, title: "Alpha" }],
      out: [{ id: renamed.id, title: "New name" }],
    });
    await expect(library.items.read({ id: page.id })).resolves.toMatchObject({
      links: { in: [{ id: byAddress.id, title: "Beta" }], out: [] },
    });
  });

  it("answers an agent's search with each hit's passage, its title when nothing else holds the words, cut short when concise", async () => {
    const { accountId, library } = await personalLibrary();
    const line = `A heron stood${" and then".repeat(40)}`;
    const { id } = await seedItem(accountId, {
      blocks: lines(line),
      fields: noteFixture({ savedAt: SAVED_AT, title: "Birds" }),
    });
    const title = `Herons ${"of the marsh ".repeat(20).trim()}`;
    const titled = await seedItem(accountId, {
      blocks: lines("Nothing here."),
      fields: noteFixture({ savedAt: SAVED_AT - 3 * 24 * 60 * 60 * 1000, title }),
    });

    const recent = await library.search({ query: "heron", savedAfter: "2026-10-01" });
    expect(recent.hits).toStrictEqual([
      {
        id,
        kind: "note",
        savedAt: new Date(SAVED_AT).toISOString(),
        snippet: `${line.slice(0, 87)}…`,
        title: "Birds",
        url: null,
      },
    ]);
    const older = await library.search({ query: "heron", savedBefore: "2026-09-30" });
    expect(older.hits).toMatchObject([{ id: titled.id, snippet: title.slice(0, 160) }]);
    const detailed = await library.search({
      query: "heron",
      responseFormat: "detailed",
      savedBefore: "2026-09-30",
    });
    expect(detailed.hits).toMatchObject([{ id: titled.id, snippet: title }]);
  });
});
