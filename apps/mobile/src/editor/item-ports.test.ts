import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph } from "@repo/library-replica/test-support/replica-harness";
import { fileSha } from "@repo/library-replica/library-replica";
import { blockHash } from "@repo/notes/library/block-hash";
import { describe, expect, it } from "vitest";
import { createItemPorts } from "./item-ports";

const NOW = 1_700_000_300_000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// the phone's file cache as the ports reach it: the bytes it holds by sha
const heldFiles = (held: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map()) => ({
  fileBytes: async (sha: string) => await Promise.resolve(held.get(sha) ?? null),
});

// a phone holding one landed note of one paragraph
const phoneWithNote = async () => {
  const cell = createFakeCell();
  const phone = await openDevice(cell, "phone");
  const made = await phone.replica.createNote({
    blocks: [{ block: paragraph("p1", "first"), ord: "a0", section: "note" }],
    folderId: null,
    tags: [],
    title: "Plans",
  });
  await phone.replica.sync();
  const ports = createItemPorts({ files: heldFiles(), now: () => NOW, replica: phone.replica });
  return { cell, id: made.id, phone, ports };
};

describe("an item page's questions, answered from the phone's replica", () => {
  it("reads the item as the replica holds it, and none for an item it lacks", async () => {
    const { id, ports } = await phoneWithNote();
    const { item } = await ports.item({ itemId: id });
    expect(item).toMatchObject({ bodyHeld: true, fields: { title: "Plans" } });
    expect(item?.blocks.map(({ block }) => block.id)).toStrictEqual(["p1"]);
    await expect(
      ports.item({ itemId: "0190a000-0000-7000-8000-00000000dead" }),
    ).resolves.toStrictEqual({
      item: null,
    });
  });

  it("queues a pause's ops under their bases, and answers a moved base with the item as it is", async () => {
    const { cell, id, phone, ports } = await phoneWithNote();
    const base = blockHash(paragraph("p1", "first"));
    await expect(
      ports.writeItem({
        itemId: id,
        ops: [{ baseHash: base, block: paragraph("p1", "first, edited"), op: "put" }],
      }),
    ).resolves.toStrictEqual({ kind: "queued" });
    const stale = await ports.writeItem({
      itemId: id,
      ops: [{ baseHash: base, block: paragraph("p1", "again"), op: "put" }],
    });
    expect(stale).toMatchObject({ kind: "changed" });
    await phone.replica.sync();
    expect(cell.item(id)?.blocks.get("p1")?.block).toMatchObject({
      children: [{ text: "first, edited" }],
    });
  });

  it("names every item a link can open, by id and by title", async () => {
    const { id, ports } = await phoneWithNote();
    await expect(ports.linkTargets({})).resolves.toStrictEqual({
      targets: [{ id, title: "Plans" }],
    });
  });

  it("answers a file the cache holds, typed by its bytes, and none for one it cannot reach", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const sha = fileSha(PNG);
    const ports = createItemPorts({
      files: heldFiles(new Map([[sha, PNG]])),
      now: () => NOW,
      replica: phone.replica,
    });
    await expect(ports.readFile({ sha })).resolves.toStrictEqual({
      file: { base64: btoa(String.fromCodePoint(...PNG)), mediaType: "image/png" },
    });
    await expect(ports.readFile({ sha: "b".repeat(64) })).resolves.toStrictEqual({ file: null });
  });

  it("keeps a file the page pastes, which the write naming it sends up first", async () => {
    const { cell, id, phone, ports } = await phoneWithNote();
    const { sha } = await ports.keepFile({
      base64: btoa(String.fromCodePoint(...PNG)),
      mediaType: "image/png",
    });
    expect(sha).toBe(fileSha(PNG));
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
    await phone.replica.sync();
    expect(cell.uploads).toStrictEqual([sha]);
    expect(cell.item(id)?.blocks.has("i1")).toBe(true);
    expect(phone.blobs.held()).toStrictEqual([]);
  });

  it("writes a highlight's bare entry and then its note, as the library's page does", async () => {
    const { cell, id, phone, ports } = await phoneWithNote();
    await expect(
      ports.addHighlight({ id: "h1", itemId: id, quote: "first" }),
    ).resolves.toStrictEqual({
      queued: true,
    });
    await expect(
      ports.noteHighlight({ id: "h1", itemId: id, text: "why?" }),
    ).resolves.toStrictEqual({
      queued: true,
    });
    await expect(
      ports.noteHighlight({ id: "h2", itemId: id, text: "none" }),
    ).resolves.toStrictEqual({
      queued: false,
    });
    await phone.replica.sync();
    expect(cell.annotation("h1")).toMatchObject({ quote: "first", text: "why?" });
  });

  it("makes a note of the page's blocks in the folder of the item it was made from", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const folderId = phone.newId();
    await phone.replica.writeFolders([
      { id: folderId, name: "Reading", op: "create", parentId: null, sort: "a0" },
    ]);
    const source = await phone.replica.createNote({
      blocks: [{ block: paragraph("p1", "first"), ord: "a0", section: "note" }],
      folderId,
      tags: [],
      title: "Plans",
    });
    const ports = createItemPorts({ files: heldFiles(), now: () => NOW, replica: phone.replica });

    const { id } = await ports.createNote({
      besideId: source.id,
      blocks: [{ block: paragraph("p2", "moved"), ord: "a0" }],
      title: "moved",
    });

    expect(phone.replica.row(id)?.fields).toMatchObject({ folderId, title: "moved" });
    await phone.replica.sync();
    expect(cell.item(id)?.fields.folderId).toBe(folderId);
    expect(cell.item(id)?.blocks.get("p2")).toMatchObject({ section: "note" });
  });
});
