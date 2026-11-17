// The fake cell answers as the account's own does: the cases both are held to
// (`./cell-conformance`), then the rows a suite seeds in it and reads back. The listing's pages,
// the rail's counts and every title are `library-index.ts`'s, which both answer by.

import { describe, expect, it } from "vitest";

import { cellConformance } from "./cell-conformance";
import { createFakeCell } from "./fake-cell";

cellConformance(async (run) => {
  await run(createFakeCell().device("laptop").client.library);
});

describe("the rows a suite seeds in the fake cell", () => {
  it("lands each without a call, and reads it back as the listing and items.get answer it", async () => {
    const cell = createFakeCell();
    const { library } = cell.device("laptop").client;
    const reading = cell.seed.folder("Reading");
    const id = cell.seed.item({ folderId: reading, tags: ["spring"], title: "Plans" });
    const gone = cell.seed.item({ deletedAt: 1 });

    const page = await library.listing.page({ limit: 10, scope: { kind: "all" } });
    expect(page.items).toStrictEqual([cell.listed(id)]);
    await expect(library.items.get({ id })).resolves.toStrictEqual(cell.held(id));
    await expect(library.listing.scopes()).resolves.toMatchObject({
      deleted: 1,
      folders: [{ id: reading, items: 1, name: "Reading" }],
    });
    expect(cell.held(gone).fields.deletedAt).toBe(1);
    expect(cell.calls).toStrictEqual([
      "laptop library/listing/page",
      "laptop library/items/get",
      "laptop library/listing/scopes",
    ]);
  });
});
