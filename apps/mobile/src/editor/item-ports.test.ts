import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import { fileSha } from "@repo/contract/library/file-sha";
import { paragraph } from "@repo/contract/test-support/library-items";
import { describe, expect, it } from "vitest";
import { createFileCache } from "../files/file-cache";
import { downloadBlob, v1ClientOver } from "../lib/phone-transport";
import { memoryFolder } from "../test-support/memory-folder";
import { createItemPorts, renamedTargets } from "./item-ports";

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  await Promise.resolve(fileSha(bytes));

// an item page's ports over a phone of the cell's: its client and its cache of files
const portsOver = (cell: FakeCell, name = "phone") => {
  const device = cell.device(name);
  const client = v1ClientOver(device.transport, () => {
    // a sign-in's end is the runtime's, which no suite here reaches
  });
  const files = createFileCache({
    download: async (sha) => await downloadBlob(device.transport, sha256Hex, sha),
    folder: memoryFolder(),
    shrink: async () => await Promise.resolve(null),
  });
  const ports = createItemPorts({
    library: { files, queries: createTanstackQueryUtils(client) },
    queryClient: new QueryClient(),
  });
  return { device, files, ports };
};

// the cell holding one note of one paragraph, made by another device
const cellWithNote = async (cell = createFakeCell()) => {
  const id = "0190a000-0000-7000-8000-0000000000a1";
  await cell.device("mac").client.library.items.create({
    blocks: [{ block: paragraph("p1", "first"), section: "note" }],
    folderId: null,
    id,
    opId: "0190a000-0000-7000-8000-0000000000b1",
    savedAt: 1_700_000_000_000,
    tags: [],
    title: "Plans",
  });
  return { cell, id };
};

describe("an item page's questions, answered from the account's library", () => {
  it("reads the item as the cloud holds it, none for an item it lacks, and the last read with no connection", async () => {
    const { cell, id } = await cellWithNote();
    const { device, ports } = portsOver(cell);
    const { item } = await ports.item({ itemId: id });
    expect(item).toStrictEqual({
      blocks: [{ block: paragraph("p1", "first"), section: "note" }],
      fields: expect.objectContaining({ title: "Plans" }),
    });
    await expect(
      ports.item({ itemId: "0190a000-0000-7000-8000-00000000dead" }),
    ).resolves.toStrictEqual({ item: null });

    device.setOffline(true);
    await expect(ports.item({ itemId: id })).resolves.toStrictEqual({ item });
    await expect(ports.item({ itemId: "0190a000-0000-7000-8000-00000000beef" })).rejects.toThrow(
      /network is down/u,
    );
  });

  it("names every item a link can open, by id and by title", async () => {
    const { cell, id } = await cellWithNote();
    const { ports } = portsOver(cell);
    await expect(ports.linkTargets({})).resolves.toStrictEqual({
      targets: [{ id, title: "Plans" }],
    });
  });

  it("answers a file as the type it was kept as, and none for one the cloud holds none of", async () => {
    const cell = createFakeCell();
    const { files, ports } = portsOver(cell);
    // a recording's first bytes, which name no type a sniff of a picture or a PDF knows
    const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const recording = fileSha(MP4);
    await files.keep(recording, { bytes: MP4, mime: "video/mp4" });
    await expect(ports.readFile({ sha: recording })).resolves.toStrictEqual({
      file: { base64: btoa(String.fromCodePoint(...MP4)), mediaType: "video/mp4" },
    });
    await expect(ports.readFile({ sha: "b".repeat(64) })).resolves.toStrictEqual({ file: null });
  });
});

describe("the names a link shows", () => {
  it("names each other item whose name moved, came or went", () => {
    const open = "0190a000-0000-7000-8000-0000000000a1";
    const other = "0190a000-0000-7000-8000-0000000000a2";
    const gone = "0190a000-0000-7000-8000-0000000000a3";
    const made = "0190a000-0000-7000-8000-0000000000a4";
    const kept = "0190a000-0000-7000-8000-0000000000a5";
    expect(
      renamedTargets(
        [
          { id: open, title: "Plans" },
          { id: other, title: "Trip" },
          { id: gone, title: "Old" },
          { id: kept, title: "Same" },
        ],
        [
          { id: open, title: "Plans, renamed" },
          { id: other, title: "Trip to Lisbon" },
          { id: made, title: "New" },
          { id: kept, title: "Same" },
        ],
        open,
      ).toSorted(),
    ).toStrictEqual([other, gone, made].toSorted());
  });
});
