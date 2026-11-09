import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import { uploadBlob } from "@repo/contract/library/call-outcome";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import { blockHash } from "@repo/contract/library/block-hash";
import { fileSha } from "@repo/contract/library/file-sha";
import { paragraph } from "@repo/contract/test-support/library-items";
import { describe, expect, it } from "vitest";
import { createFileCache } from "../files/file-cache";
import { createPhoneSaves } from "../items/phone-saves";
import { downloadBlob, v1ClientOver } from "../lib/phone-transport";
import { withAppReads } from "../test-support/app-reads";
import { memoryFolder } from "../test-support/memory-folder";
import { createItemPorts, renamedTargets } from "./item-ports";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const idSource = () => {
  let next = 0;
  return (): string => {
    next += 1;
    return `0190a000-0000-7000-8000-${next.toString(16).padStart(12, "0")}`;
  };
};

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  await Promise.resolve(fileSha(bytes));

// an item page's ports over a phone of the cell's: its client, its cache of files and its saves
const portsOver = (cell: FakeCell, name = "phone") => {
  const device = withAppReads(cell, cell.device(name));
  const client = v1ClientOver(device.transport, () => {
    // a sign-in's end is the runtime's, which no suite here reaches
  });
  const files = createFileCache({
    download: async (sha) => await downloadBlob(device.transport, sha256Hex, sha),
    folder: memoryFolder(),
    shrink: async () => await Promise.resolve(null),
  });
  const newId = idSource();
  const saves = createPhoneSaves({
    client,
    files,
    newBlockId: idSource(),
    newId,
    now: () => 1_700_000_000_000,
    sha256Hex,
    upload: async (file) => await uploadBlob(device.transport, file),
  });
  const wrote: { itemId: string; seq: number }[] = [];
  const ports = createItemPorts({
    library: { client, files, newId, queries: createTanstackQueryUtils(client), saves },
    queryClient: new QueryClient(),
    wrote: (itemId, seq) => {
      wrote.push({ itemId, seq });
    },
  });
  return { client, device, files, ports, wrote };
};

// the cell holding one note of one paragraph, made by another device
const cellWithNote = async (cell = createFakeCell(), folderId: string | null = null) => {
  const id = "0190a000-0000-7000-8000-0000000000a1";
  await cell.device("mac").client.library.items.create({
    blocks: [{ block: paragraph("p1", "first"), ord: "a0", section: "note" }],
    folderId,
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
    expect(item).toMatchObject({ bodyHeld: true, fields: { title: "Plans" } });
    expect(item?.blocks.map(({ block }) => block.id)).toStrictEqual(["p1"]);
    await expect(
      ports.item({ itemId: "0190a000-0000-7000-8000-00000000dead" }),
    ).resolves.toStrictEqual({ item: null });

    device.setOffline(true);
    await expect(ports.item({ itemId: id })).resolves.toStrictEqual({ item });
    await expect(ports.item({ itemId: "0190a000-0000-7000-8000-00000000beef" })).rejects.toThrow(
      /network is down/u,
    );
  });

  it("writes a pause's ops under their bases, and answers a moved base with the item as it is", async () => {
    const { cell, id } = await cellWithNote();
    const { ports, wrote } = portsOver(cell);
    const base = blockHash(paragraph("p1", "first"));
    await expect(
      ports.writeItem({
        itemId: id,
        ops: [{ baseHash: base, block: paragraph("p1", "first, edited"), op: "put" }],
      }),
    ).resolves.toStrictEqual({ kind: "queued" });
    expect(wrote).toStrictEqual([{ itemId: id, seq: cell.item(id)?.seq }]);

    const stale = await ports.writeItem({
      itemId: id,
      ops: [{ baseHash: base, block: paragraph("p1", "again"), op: "put" }],
    });
    expect(stale).toMatchObject({
      item: { blocks: [{ block: { children: [{ text: "first, edited" }] } }] },
      kind: "changed",
    });
    expect(cell.item(id)?.blocks.get("p1")?.block).toMatchObject({
      children: [{ text: "first, edited" }],
    });
  });

  it("throws a write that met no connection, so the page keeps the edit", async () => {
    const { cell, id } = await cellWithNote();
    const { device, ports } = portsOver(cell);
    device.setOffline(true);
    await expect(
      ports.writeItem({
        itemId: id,
        ops: [
          { baseHash: blockHash(paragraph("p1", "first")), block: paragraph("p1", "x"), op: "put" },
        ],
      }),
    ).rejects.toThrow(/network is down/u);
    expect(cell.item(id)?.blocks.get("p1")?.block).toMatchObject({ children: [{ text: "first" }] });
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

  it("sends up a file the page pastes before the write naming it", async () => {
    const { cell, id } = await cellWithNote();
    const { ports } = portsOver(cell);
    const { sha } = await ports.keepFile({
      base64: btoa(String.fromCodePoint(...PNG)),
      mediaType: "image/png",
    });
    expect(sha).toBe(fileSha(PNG));
    expect(cell.uploads).toStrictEqual([sha]);
    await ports.writeItem({
      itemId: id,
      ops: [
        {
          block: { children: [{ text: "" }], id: "i1", sha, type: "img" },
          op: "insert",
          ord: "a1",
          section: "note",
        },
      ],
    });
    expect(cell.item(id)?.blocks.has("i1")).toBe(true);
  });

  it("makes a note of the page's blocks in the folder of the item it was made from", async () => {
    const folderId = "0190a000-0000-7000-8000-0000000000f1";
    const cell = createFakeCell();
    await cell.device("mac").client.library.folders.write({
      opId: "0190a000-0000-7000-8000-0000000000f2",
      ops: [{ id: folderId, name: "Reading", op: "create", parentId: null, sort: "a0" }],
    });
    const { id: source } = await cellWithNote(cell, folderId);
    const { ports } = portsOver(cell);

    const { id } = await ports.createNote({
      besideId: source,
      blocks: [{ block: paragraph("p2", "moved"), ord: "a0" }],
      title: "moved",
    });

    expect(cell.item(id)?.fields).toMatchObject({ folderId, title: "moved" });
    expect(cell.item(id)?.blocks.get("p2")).toMatchObject({ section: "note" });
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
