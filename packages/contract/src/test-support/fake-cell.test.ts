// The fake cell answers as the account's own does: the cases both are held to
// (`./cell-conformance`), then a sweep, which the two land apart, and the rows a suite seeds in it
// and reads back. The listing's pages, the rail's counts and every title are `library-index.ts`'s,
// which both answer by.

import { describe, expect, it } from "vitest";

import { cellConformance } from "./cell-conformance";
import { createFakeCell } from "./fake-cell";

cellConformance(async (run) => {
  await run(createFakeCell().device("laptop").client.library);
});

// The cell lands a sweep on its alarm, a lot a transaction, which no client runs
// (`packages/service/src/library/library-router.test.ts` holds that), and the fake lands one as it
// is asked, so a read made right after the ask is the one answer the two give apart.
describe("a sweep of the fake cell", () => {
  it("lands every item its scope lists but those left out, each by its verb's rule", async () => {
    const cell = createFakeCell();
    const { library } = cell.device("laptop").client;
    const kept = cell.seed.item({ title: "Kept" });
    const swept = cell.seed.item({ tags: ["field"], title: "Swept" });

    await expect(
      library.items.sweep({
        except: [kept],
        scope: { kind: "all" },
        verb: { addTags: ["done"], kind: "organize", removeTags: ["field"] },
      }),
    ).resolves.toStrictEqual({ items: 1 });
    expect(cell.held(swept).fields.tags).toStrictEqual(["done"]);

    await library.items.sweep({ except: [kept], scope: { kind: "all" }, verb: { kind: "delete" } });
    await library.items.sweep({ except: [], scope: { kind: "deleted" }, verb: { kind: "purge" } });
    await expect(library.listing.scopes()).resolves.toMatchObject({ deleted: 0, total: 1 });
    expect(cell.item(swept)).toBeNull();
  });
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
