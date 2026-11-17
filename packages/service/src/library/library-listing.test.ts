import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryScope } from "@repo/contract/library-scope";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { signInPhone, signUpUser, userIdOf } from "../test-support/auth-requests";
import { personalLibrary, seedFolder, seedItem } from "../test-support/library-fixture";
import { extensionHeaders, phoneHeaders, v1Link } from "../test-support/v1-link";

const SAVED_AT = Date.UTC(2026, 9, 1);
const LINK = "https://example.com/durian";

// a laptop's library: a fresh account, its router client, and notes it saved one a second apart
const laptop = async () => {
  const { accountId, library } = await personalLibrary();
  let saved = 0;
  const note = async (
    title: string,
    fields: Partial<LibraryItemFields> = {},
    blocks: readonly BodyBlock[] = [{ block: paragraph("p1", `${title}.`), section: "note" }],
  ): Promise<string> => {
    saved += 1;
    const { id } = await seedItem(accountId, {
      blocks,
      fields: noteFixture({ savedAt: SAVED_AT + saved * 1000, title, ...fields }),
    });
    return id;
  };
  return { accountId, library, note };
};

const BY_TITLE = { scope: { kind: "all" }, sort: "title" } as const;

dbSuite("what the apps read of the library", () => {
  it("pages a listing from where the last page ended, counting each kind", async () => {
    const { library, note } = await laptop();
    for (const title of ["Cherry", "Apple", "Banana"]) {
      await note(title);
    }
    await note("", { kind: "link", url: LINK });

    const first = await library.listing.page({ ...BY_TITLE, kinds: ["note"], limit: 2 });
    expect(first.items.map(({ card }) => card.title)).toStrictEqual(["Apple", "Banana"]);
    expect(first).toMatchObject({ cursor: 2, kindCounts: { link: 1, note: 3 }, total: 3 });

    const last = await library.listing.page({
      ...BY_TITLE,
      cursor: first.cursor ?? 0,
      kinds: ["note"],
      limit: 2,
    });
    expect(last.items.map(({ card }) => card.title)).toStrictEqual(["Cherry"]);
    expect(last.cursor).toBeNull();
    await expect(
      library.listing.page({ ...BY_TITLE, cursor: 9, kinds: ["note"], limit: 2 }),
    ).resolves.toMatchObject({ cursor: null, items: [], total: 3 });
  });

  it("orders each sort pinned first, then the newest saved, the latest changed or the title", async () => {
    const { accountId, library, note } = await laptop();
    const banana = await note("banana", { pinnedAt: SAVED_AT });
    const apple = await note("Apple");
    const cherry = await note("cherry");
    const { id: changed } = await seedItem(accountId, {
      fields: noteFixture({ savedAt: SAVED_AT, title: "Date" }),
      updatedAt: SAVED_AT + 60_000,
    });
    const ids = async (sort: "saved" | "modified" | "title") => {
      const page = await library.listing.page({ limit: 10, scope: { kind: "all" }, sort });
      return page.items.map(({ id }) => id);
    };
    await expect(ids("saved")).resolves.toStrictEqual([banana, cherry, apple, changed]);
    await expect(ids("modified")).resolves.toStrictEqual([banana, changed, cherry, apple]);
    await expect(ids("title")).resolves.toStrictEqual([banana, apple, cherry, changed]);
  });

  it("lists a tag with the tags under it, a folder with what is under it, and Unsorted", async () => {
    const { accountId, library, note } = await laptop();
    const projects = await seedFolder(accountId, { name: "Projects" });
    const garden = await seedFolder(accountId, { name: "Garden", parentId: projects });
    const archive = await seedFolder(accountId, { deletedAt: SAVED_AT, name: "Archive" });
    await note("Filed", { folderId: garden, tags: ["work/garden"] });
    await note("Loose", { tags: ["working"] });
    await note("Archived", { folderId: archive, tags: ["work_x/y"] });

    const titlesOf = async (scope: LibraryScope) => {
      const page = await library.listing.page({ limit: 10, scope, sort: "title" });
      return page.items.map(({ card }) => card.title);
    };
    await expect(titlesOf({ kind: "tag", tag: "WORK" })).resolves.toStrictEqual(["Filed"]);
    await expect(titlesOf({ kind: "tag", tag: "work_" })).resolves.toStrictEqual([]);
    await expect(titlesOf({ folderId: projects, kind: "folder" })).resolves.toStrictEqual([
      "Filed",
    ]);
    // a folder deleted since lists nothing, and what it held reads as unsorted
    await expect(titlesOf({ folderId: archive, kind: "folder" })).resolves.toStrictEqual([]);
    await expect(titlesOf({ kind: "unsorted" })).resolves.toStrictEqual(["Archived", "Loose"]);
  });

  it("counts the rail: folders in rail order, each tag once under the spelling saved order meets first", async () => {
    const { accountId, library, note } = await laptop();
    const projects = await seedFolder(accountId, { name: "Projects", sort: "a1" });
    const garden = await seedFolder(accountId, { name: "Garden", parentId: projects, sort: "a0" });
    const archive = await seedFolder(accountId, { name: "Archive", sort: "a0" });
    await note("One", { folderId: garden, tags: ["work"] });
    await note("Two", { tags: ["Work", "home"] });
    await note("Three", { deletedAt: SAVED_AT, tags: ["gone"] });
    // its field and its body spell one tag two ways, and it counts once
    await note("Four", { tags: ["HOME"] }, [
      { block: paragraph("p1", "Back #home soon."), section: "note" },
    ]);
    await note("Five");

    await expect(library.listing.scopes()).resolves.toStrictEqual({
      deleted: 1,
      folders: [
        { id: archive, items: 0, name: "Archive", parentId: null, sort: "a0" },
        { id: projects, items: 1, name: "Projects", parentId: null, sort: "a1" },
        { id: garden, items: 1, name: "Garden", parentId: projects, sort: "a0" },
      ],
      tags: [
        { items: 2, tag: "HOME" },
        { items: 2, tag: "Work" },
      ],
      total: 4,
      unsorted: 3,
      untagged: 1,
    });
    const { tags } = await library.listing.scopes();
    await expect(library.organize.outline()).resolves.toStrictEqual({
      folders: [
        { id: archive, items: 0, name: "Archive", parentId: null },
        { id: projects, items: 1, name: "Projects", parentId: null },
        { id: garden, items: 1, name: "Garden", parentId: projects },
      ],
      tags,
    });
  });

  it("titles every item in the library, pinned first, and none in Deleted", async () => {
    const { library, note } = await laptop();
    const beta = await note("Beta");
    const alpha = await note("alpha");
    const pinned = await note("Zulu", { pinnedAt: SAVED_AT });
    await note("Gone", { deletedAt: SAVED_AT });
    await expect(library.listing.titles()).resolves.toStrictEqual({
      targets: [
        { id: pinned, title: "Zulu" },
        { id: alpha, title: "alpha" },
        { id: beta, title: "Beta" },
      ],
    });
  });

  it("answers an agent's list a page at a time, filtered and in the order asked", async () => {
    const { accountId, library, note } = await laptop();
    const projects = await seedFolder(accountId, { name: "Projects" });
    const one = await note("Item 1.", { folderId: projects, tags: ["n"] });
    const two = await note("Item 2.", { tags: ["N"] }, [
      { block: paragraph("p1", "Read #later."), section: "note" },
    ]);
    const three = await note("Item 3.", { pinnedAt: SAVED_AT, tags: ["n"] });

    const first = await library.items.list({ limit: 2 });
    expect(first.items.map(({ id }) => id)).toStrictEqual([three, two]);
    expect(first.cursor).toBe(2);
    const rest = await library.items.list({ cursor: first.cursor ?? 0, limit: 2 });
    expect(rest).toMatchObject({ cursor: null, items: [{ id: one }] });

    const byTitle = await library.items.list({ kinds: ["note"], sort: "title", tag: "N" });
    expect(byTitle.items.map(({ id }) => id)).toStrictEqual([three, one, two]);
    // a summary names every tag its item carries, the one written in its note too
    await expect(library.items.list({ tag: "later" })).resolves.toStrictEqual({
      cursor: null,
      items: [
        {
          folderId: null,
          id: two,
          kind: "note",
          pinned: false,
          savedAt: new Date(SAVED_AT + 2000).toISOString(),
          tags: ["N", "later"],
          title: "Item 2.",
          url: null,
        },
      ],
    });
    await expect(
      library.items.list({ folderId: projects, responseFormat: "detailed" }),
    ).resolves.toMatchObject({ items: [{ id: one, preview: "Item 1..", site: null }] });
    await expect(library.items.list({ pinned: false, tag: "n" })).resolves.toMatchObject({
      items: [{ id: two }, { id: one }],
    });
    await expect(library.items.list({ kinds: ["link"] })).resolves.toStrictEqual({
      cursor: null,
      items: [],
    });
  });

  it("lists, counts and titles no other account's items or folders", async () => {
    const { library, note } = await laptop();
    const mine = await note("Mine", { tags: ["shared"] });
    const other = await laptop();
    const theirs = await seedFolder(other.accountId, { name: "Theirs" });
    await other.note("Theirs", { folderId: theirs, tags: ["shared"] });

    await expect(
      library.listing.page({ limit: 10, scope: { kind: "all" } }),
    ).resolves.toMatchObject({ items: [{ id: mine }], total: 1 });
    await expect(
      library.listing.page({ limit: 10, scope: { folderId: theirs, kind: "folder" } }),
    ).resolves.toMatchObject({ items: [], total: 0 });
    await expect(library.listing.scopes()).resolves.toMatchObject({
      folders: [],
      tags: [{ items: 1, tag: "shared" }],
      total: 1,
    });
    await expect(library.listing.titles()).resolves.toStrictEqual({
      targets: [{ id: mine, title: "Mine" }],
    });
  });

  it("answers a signed-in device on /v1/rpc from its own account's library", async () => {
    const { cookie } = await signUpUser("library-reads@example.test");
    const accountId = await userIdOf(cookie);
    const { id } = await seedItem(accountId, { fields: noteFixture({ title: "On the wire" }) });
    for (const link of [
      v1Link(phoneHeaders(await signInPhone("library-reads@example.test"))),
      v1Link(extensionHeaders(cookie)),
    ]) {
      await expect(link.library.items.list({})).resolves.toMatchObject({
        items: [{ id, title: "On the wire" }],
      });
      await expect(
        link.library.listing.page({ limit: 10, scope: { kind: "all" } }),
      ).resolves.toMatchObject({ items: [{ id }], total: 1 });
    }
  });
});
