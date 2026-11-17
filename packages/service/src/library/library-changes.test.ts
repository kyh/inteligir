// What moved after a head, over Postgres and through the contract as a device asks it: the first
// ask learns the head alone, each later one names the items and folders stamped past the head it
// sends, a purged item among them, and a library emptied under a device names everything.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { personalLibrary, seedItem } from "../test-support/library-fixture";
import { mintLibraryId } from "./library-ids";

const SAVED_AT = 1_700_000_000_000;

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const note = async (library: Library, text: string): Promise<string> => {
  const id = mintLibraryId(Date.now());
  const blocks: BodyBlock[] = [{ block: paragraph(`${id}-0`, text), section: "note" }];
  await library.items.create({
    blocks,
    folderId: null,
    id,
    savedAt: SAVED_AT,
    tags: [],
    title: text,
  });
  return id;
};

const seqOf = async (library: Library, id: string): Promise<number> => {
  const { seq } = await library.items.row({ id });
  return seq;
};

dbSuite("what moved in the library after a head", () => {
  it("learns the head alone on the first ask, and names nothing at the head", async () => {
    const { library } = await personalLibrary();
    await expect(library.changes({})).resolves.toStrictEqual({ head: 0, moved: null });
    await note(library, "First.");

    const { head } = await library.changes({});
    expect(head).toBeGreaterThan(0);
    await expect(library.changes({ after: head })).resolves.toStrictEqual({ head, moved: null });
  });

  it("names each item stamped past the head at its sequence, a purged one too, and a folder that moved", async () => {
    const { library } = await personalLibrary();
    const kept = await note(library, "Kept.");
    const gone = await note(library, "Gone.");
    const { head } = await library.changes({});

    await library.items.organize({ ids: [kept], title: "Kept still" });
    await library.items.delete({ ids: [gone] });
    await library.items.purge({ ids: [gone] });
    const after = await library.changes({ after: head });
    expect(after.moved).toStrictEqual({
      folders: false,
      items: [
        { id: kept, seq: await seqOf(library, kept) },
        { id: gone, seq: after.head },
      ],
      threads: [],
    });

    await library.folders.write({
      ops: [
        {
          id: mintLibraryId(Date.now()),
          name: "Reading",
          op: "create",
          parentId: null,
          sort: "a0",
        },
      ],
    });
    const folders = await library.changes({ after: after.head });
    expect(folders.moved).toStrictEqual({ folders: true, items: [], threads: [] });
  });

  it("names nothing another account wrote", async () => {
    const { library } = await personalLibrary();
    await note(library, "Mine.");
    const { head } = await library.changes({});
    const { library: stranger } = await personalLibrary();
    await note(stranger, "Theirs.");
    await note(stranger, "Theirs too.");

    await expect(library.changes({ after: head })).resolves.toStrictEqual({ head, moved: null });
  });

  it("says every item moved past the most one answer names, and everything past a head it never reached", async () => {
    const { accountId, library } = await personalLibrary();
    await note(library, "Written.");
    const { head } = await library.changes({});
    // as the write that took the head might have stamped them
    for (let at = 0; at < 200; at += 1) {
      await seedItem(accountId, {
        fields: noteFixture({ savedAt: SAVED_AT, title: `Seeded ${String(at)}` }),
        seq: head,
      });
    }

    await expect(library.changes({ after: head - 1 })).resolves.toStrictEqual({
      head,
      moved: { folders: false, items: "all", threads: [] },
    });
    await expect(library.changes({ after: head + 5 })).resolves.toStrictEqual({
      head,
      moved: { folders: true, items: "all", threads: "all" },
    });
  });
});
