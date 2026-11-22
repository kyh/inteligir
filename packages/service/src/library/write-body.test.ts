import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { db } from "@repo/db/drizzle-client";
import { itemSearch } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { signUpUser } from "../test-support/auth-requests.test-utils";
import { personalLibrary, seedFile } from "../test-support/library.fixture";
import { pageHeaders, v1Link } from "../test-support/v1-link.test-utils";
import { mintLibraryId } from "./library-ids";

const SAVED_AT = 1_700_000_000_000;
const SHA = "b".repeat(64);

const line = (text: string) =>
  ({
    block: paragraph(randomUUID(), text),
    section: "note",
  }) satisfies BodyBlock;

const noteOf = (blocks: readonly BodyBlock[]) => ({
  blocks: [...blocks],
  parentId: null,
  id: mintLibraryId(Date.now()),
  savedAt: SAVED_AT,
  tags: [],
  title: "Plans",
});

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

const searchTextOf = async (accountId: string, id: string) => {
  const [row] = await db
    .select({ text: itemSearch.text })
    .from(itemSearch)
    .where(and(eq(itemSearch.accountId, accountId), eq(itemSearch.itemId, id)));

  return row?.text;
};

dbSuite("a note's body saved over its version", () => {
  it("saves over the version it was opened at, stamping the item for every device to see", async () => {
    const { accountId, library } = await personalLibrary();
    const first = line("First.");
    const made = noteOf([first]);
    await library.items.create(made);
    const opened = await library.items.get({ id: made.id });
    expect(opened.bodyVersion).toBe(1);
    const { head } = await library.changes({});

    const blocks = [first, line("Second.")];
    const saved = await library.items.saveBody({ baseVersion: 1, blocks, id: made.id });
    expect(saved).toStrictEqual({ kind: "saved", seq: head + 1, version: 2 });
    await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
      blocks,
      bodyVersion: 2,
      seq: head + 1,
    });
    await expect(library.items.row({ id: made.id })).resolves.toMatchObject({
      bodyVersion: 2,
      seq: head + 1,
    });
    await expect(library.changes({ after: head })).resolves.toMatchObject({
      head: head + 1,
      moved: { items: [{ id: made.id, seq: head + 1 }] },
    });
    await expect(searchTextOf(accountId, made.id)).resolves.toBe("First.\nSecond.");
  });

  it("answers a second save over the same version stale, keeping the first", async () => {
    const { library } = await personalLibrary();
    const made = noteOf([line("Shared.")]);
    await library.items.create(made);
    const mine = [...made.blocks, line("From the phone.")];
    const theirs = [...made.blocks, line("From the Mac.")];

    await expect(
      library.items.saveBody({ baseVersion: 1, blocks: mine, id: made.id }),
    ).resolves.toMatchObject({ kind: "saved", version: 2 });
    await expect(
      library.items.saveBody({ baseVersion: 1, blocks: theirs, id: made.id }),
    ).resolves.toStrictEqual({ kind: "stale", version: 2 });
    await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
      blocks: mine,
      bodyVersion: 2,
    });
  });

  it("answers a save sent again after its answer was lost as saved, writing nothing twice", async () => {
    const { library } = await personalLibrary();
    const made = noteOf([line("Once.")]);
    await library.items.create(made);
    const blocks = [...made.blocks, line("Sent twice.")];
    const saved = await library.items.saveBody({ baseVersion: 1, blocks, id: made.id });
    await expect(
      library.items.saveBody({ baseVersion: 1, blocks, id: made.id }),
    ).resolves.toStrictEqual(saved);
    await expect(library.items.row({ id: made.id })).resolves.toMatchObject({ bodyVersion: 2 });
  });

  it("answers a body past the cap full, and keeps the one it holds", async () => {
    const { library } = await personalLibrary();
    const made = noteOf([line("Small.")]);
    await library.items.create(made);
    const blocks = Array.from({ length: 3 }, () => line("a".repeat(400_000)));
    await expect(
      library.items.saveBody({ baseVersion: 1, blocks, id: made.id }),
    ).resolves.toStrictEqual({ kind: "full", maxBytes: BODY_MAX_BYTES });
    await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
      blocks: made.blocks,
      bodyVersion: 1,
    });
  });

  it("answers a note in Deleted deleted, and one the library never held not found", async () => {
    const { library } = await personalLibrary();
    const made = noteOf([line("Gone soon.")]);
    await library.items.create(made);
    await library.items.delete({ ids: [made.id] });
    await expect(
      library.items.saveBody({ baseVersion: 1, blocks: [line("Too late.")], id: made.id }),
    ).resolves.toStrictEqual({ kind: "deleted" });
    await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
      blocks: made.blocks,
    });
    expect(
      await codeOf(
        library.items.saveBody({ baseVersion: 1, blocks: [], id: mintLibraryId(Date.now()) }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("refuses a body naming a file the library does not hold, and saves it once it does", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf([line("A picture follows.")]);
    await library.items.create(made);

    const picture: BodyBlock = {
      block: { children: [{ text: "" }], id: "img1", sha: SHA, type: "img" },
      section: "note",
    };

    const blocks = [...made.blocks, picture];
    expect(await codeOf(library.items.saveBody({ baseVersion: 1, blocks, id: made.id }))).toBe(
      "BLOB_MISSING",
    );
    await seedFile(accountId, SHA);
    await expect(
      library.items.saveBody({ baseVersion: 1, blocks, id: made.id }),
    ).resolves.toMatchObject({ kind: "saved", version: 2 });
  });

  it("lands a page's article on the body as the person last saved it, so an older save is stale", async () => {
    const { library } = await personalLibrary();
    const url = "https://pages.example/article";
    const { item } = await library.items.saveLink({ url });
    const thoughts = line("My thoughts first.");
    await library.items.saveBody({ baseVersion: 1, blocks: [thoughts], id: item.id });

    const article = paragraph(randomUUID(), "The article as read.");
    await library.items.save({
      article: [article],
      coverSha: null,
      facts: { author: null, description: null, lang: null, published: null, site: null },
      parentId: null,
      id: mintLibraryId(Date.now()),
      savedAt: SAVED_AT,
      tags: [],
      title: "A page",
      url,
    });
    const read = [thoughts, { block: article, section: "article" }];
    await expect(library.items.get({ id: item.id })).resolves.toMatchObject({
      blocks: read,
      bodyVersion: 3,
    });

    const typed = [thoughts, line("Typed meanwhile.")];
    await expect(
      library.items.saveBody({ baseVersion: 2, blocks: typed, id: item.id }),
    ).resolves.toStrictEqual({ kind: "stale", version: 3 });
    const merged = [...typed, { block: article, section: "article" as const }];
    await expect(
      library.items.saveBody({ baseVersion: 3, blocks: merged, id: item.id }),
    ).resolves.toMatchObject({ kind: "saved", version: 4 });
  });

  it("saves through /v1/rpc as a tab does", async () => {
    const { cookie } = await signUpUser("body-save@example.test");
    const tab = v1Link(pageHeaders(cookie));
    const made = noteOf([line("Over the wire.")]);
    await tab.library.items.create(made);
    const blocks = [...made.blocks, line("Saved over it.")];
    await expect(
      tab.library.items.saveBody({ baseVersion: 1, blocks, id: made.id }),
    ).resolves.toMatchObject({ kind: "saved", version: 2 });
    await expect(
      tab.library.items.saveBody({ baseVersion: 1, blocks: made.blocks, id: made.id }),
    ).resolves.toStrictEqual({ kind: "stale", version: 2 });
  });
});
