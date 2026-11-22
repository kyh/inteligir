import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryScope } from "@repo/contract/library-scope";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { signInPhone, signUpUser, userIdOf } from "../test-support/auth-requests.test-utils";
import { personalLibrary, seedFolder, seedItem } from "../test-support/library.fixture";
import { extensionHeaders, phoneHeaders, v1Link } from "../test-support/v1-link.test-utils";

const SAVED_AT = Date.UTC(2026, 9, 1);
const LINK = "https://example.com/durian";

const laptop = async () => {
  const { accountId, library } = await personalLibrary();
  let saved = 0;

  const note = async (
    title: string,
    fields: Partial<LibraryItemFields> = {},
    blocks: readonly BodyBlock[] = [{ block: paragraph("p1", `${title}.`), section: "note" }],
  ) => {
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
    await note("Filed", { parentId: garden, tags: ["work/garden"] });
    await note("Loose", { tags: ["working"] });
    await note("Archived", { parentId: archive, tags: ["work_x/y"] });

    const titlesOf = async (scope: LibraryScope) => {
      const page = await library.listing.page({ limit: 10, scope, sort: "title" });

      return page.items.map(({ card }) => card.title);
    };

    await expect(titlesOf({ kind: "tag", tag: "WORK" })).resolves.toStrictEqual(["Filed"]);
    await expect(titlesOf({ kind: "tag", tag: "work_" })).resolves.toStrictEqual([]);
    await expect(titlesOf({ parentId: projects, kind: "parent" })).resolves.toStrictEqual([
      "Filed",
    ]);
    await expect(titlesOf({ parentId: archive, kind: "parent" })).resolves.toStrictEqual([]);
    await expect(titlesOf({ kind: "unsorted" })).resolves.toStrictEqual(["Archived", "Loose"]);
  });

  it("counts the rail: folders in rail order, each tag once under the spelling saved order meets first", async () => {
    const { accountId, library, note } = await laptop();
    const projects = await seedFolder(accountId, { name: "Projects" });
    const garden = await seedFolder(accountId, { name: "Garden", parentId: projects });
    const archive = await seedFolder(accountId, { name: "Archive" });
    await note("One", { parentId: garden, tags: ["work"] });
    await note("Two", { tags: ["Work", "home"] });
    await note("Three", { deletedAt: SAVED_AT, tags: ["gone"] });
    await note("Four", { tags: ["HOME"] }, [
      { block: paragraph("p1", "Back #home soon."), section: "note" },
    ]);
    await note("Five");

    await expect(library.listing.scopes()).resolves.toStrictEqual({
      deleted: 1,
      containers: [
        { id: archive, items: 0, kind: "folder", parentId: null, title: "Archive" },
        { id: projects, items: 1, kind: "folder", parentId: null, title: "Projects" },
        { id: garden, items: 1, kind: "folder", parentId: projects, title: "Garden" },
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
    const { containers } = await library.listing.scopes();
    await expect(library.organize.outline()).resolves.toStrictEqual({ containers, tags });
  });

  it("keeps folders and lists out of live listings, counts and titles, and lists them in Deleted", async () => {
    const { accountId, library, note } = await laptop();
    const shelf = await seedFolder(accountId, { kind: "list", name: "Shelf" });
    const bin = await seedFolder(accountId, { deletedAt: SAVED_AT, name: "Bin" });
    const kept = await note("Kept", { parentId: shelf });

    const all = await library.listing.page({ limit: 10, scope: { kind: "all" } });
    expect(all.items.map(({ id }) => id)).toStrictEqual([kept]);
    expect(all.kindCounts).toMatchObject({ folder: 0, list: 0, note: 1 });
    const binned = await library.listing.page({ limit: 10, scope: { kind: "deleted" } });
    expect(binned.items.map(({ id }) => id)).toStrictEqual([bin]);
    await expect(library.listing.scopes()).resolves.toMatchObject({
      containers: [{ id: shelf, items: 1, kind: "list", parentId: null, title: "Shelf" }],
      deleted: 1,
      total: 1,
      unsorted: 0,
    });
    await expect(library.listing.titles()).resolves.toStrictEqual({
      targets: [{ id: kept, title: "Kept" }],
    });
  });

  it("lists the notes right under a parent for the tree, saying which hold more, and the root's", async () => {
    const { accountId, library, note } = await laptop();
    const projects = await seedFolder(accountId, { name: "Projects" });
    const plan = await note("Plan", { parentId: projects });
    const sub = await note("Sub", { parentId: plan });
    await note("Clip", { kind: "link", parentId: projects, url: "https://example.com/clip" });
    const loose = await note("Loose");
    await note("Gone", { deletedAt: SAVED_AT, parentId: projects });

    await expect(library.listing.children({ parentId: projects })).resolves.toStrictEqual({
      children: [{ hasChildren: true, id: plan, kind: "note", title: "Plan" }],
      more: false,
    });
    await expect(library.listing.children({ parentId: plan })).resolves.toStrictEqual({
      children: [{ hasChildren: false, id: sub, kind: "note", title: "Sub" }],
      more: false,
    });
    await expect(library.listing.children({ parentId: null })).resolves.toStrictEqual({
      children: [{ hasChildren: false, id: loose, kind: "note", title: "Loose" }],
      more: false,
    });

    const inProjects = await library.listing.page({
      limit: 10,
      scope: { kind: "parent", parentId: projects },
      sort: "title",
    });

    expect(inProjects.items.map(({ card }) => card.title)).toStrictEqual(["Clip", "Plan", "Sub"]);
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
    const one = await note("Item 1.", { parentId: projects, tags: ["n"] });

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
    await expect(library.items.list({ tag: "later" })).resolves.toStrictEqual({
      cursor: null,
      items: [
        {
          parentId: null,
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
      library.items.list({ parentId: projects, responseFormat: "detailed" }),
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
    await other.note("Theirs", { parentId: theirs, tags: ["shared"] });

    await expect(
      library.listing.page({ limit: 10, scope: { kind: "all" } }),
    ).resolves.toMatchObject({ items: [{ id: mine }], total: 1 });
    await expect(
      library.listing.page({ limit: 10, scope: { parentId: theirs, kind: "parent" } }),
    ).resolves.toMatchObject({ items: [], total: 0 });
    await expect(library.listing.scopes()).resolves.toMatchObject({
      containers: [],
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
