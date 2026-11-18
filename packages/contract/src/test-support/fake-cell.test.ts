// The fake cell answers as the account's own does: the cases both are held to
// (`./cell-conformance`), then the rows a suite seeds in it and reads back. The listing's pages, the
// rail's counts and every title are `library-index.ts`'s, which both answer by.

import { describe, expect, it } from "vitest";

import type { BodyBlock } from "../library/derive-item";
import { fileSha } from "../library/file-sha";
import { uploadBlob } from "../rpc/call-outcome";
import { BlobMissingError } from "../rpc/v1-errors";
import { cellConformance } from "./cell-conformance";
import { createFakeCell } from "./fake-cell";

// the fake lands every write, a sweep's whole too, as it is asked, so no job is ever due
cellConformance(async (run) => {
  const { client, transport } = createFakeCell().device("laptop");
  await run({
    library: client.library,
    runDue: async () => {
      await Promise.resolve();
    },
    upload: async (bytes, mime) => {
      const sha = fileSha(bytes);
      await uploadBlob(transport, { bytes, mime, sha });
      return sha;
    },
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

  it("refuses a live one at an address a live item holds, as no write could land it", () => {
    const cell = createFakeCell();
    const url = "https://example.com/held";
    cell.seed.item({ deletedAt: 1, kind: "link", url });
    const held = cell.seed.item({ kind: "link", url });

    expect(() => cell.seed.item({ kind: "link", url: `${url}#top` })).toThrow(
      `a live item holds ${url}#top already`,
    );
    expect([...cell.items().keys()]).toHaveLength(2);
    expect(cell.held(held).fields.deletedAt).toBeNull();
  });

  it("refuses one naming a file whose bytes never came up, as no write could land it", () => {
    const cell = createFakeCell();
    const sha = "a".repeat(64);
    const picture: BodyBlock = {
      block: { children: [{ text: "" }], id: "p", sha, type: "img" },
      section: "note",
    };

    expect(() => cell.seed.item({}, [picture])).toThrow(BlobMissingError);
    expect(() => cell.seed.item({ coverSha: sha })).toThrow(BlobMissingError);
    expect(cell.items().size).toBe(0);
  });
});
