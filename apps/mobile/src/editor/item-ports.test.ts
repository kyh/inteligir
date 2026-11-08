import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph } from "@repo/library-replica/test-support/replica-harness";
import { blockHash } from "@repo/notes/library/block-hash";
import { fileSha } from "@repo/notes/library/file-sha";
import { describe, expect, it } from "vitest";
import type { HeldFile } from "../files/file-cache";
import { createItemPorts } from "./item-ports";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// the phone's file cache as the ports reach it: the files it holds by sha, with their types
const heldFiles = (held: ReadonlyMap<string, HeldFile> = new Map()) => ({
  heldFile: async (sha: string) => await Promise.resolve(held.get(sha) ?? null),
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
  const ports = createItemPorts({ files: heldFiles(), replica: phone.replica });
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

  it("answers a pause on blocks of a body still to come as waiting for it", async () => {
    const { cell, id } = await phoneWithNote();
    cell.setBodiesPerAnswer(0);
    const phone = await openDevice(cell, "second phone");
    await phone.replica.sync();
    const ports = createItemPorts({ files: heldFiles(), replica: phone.replica });

    await expect(
      ports.writeItem({
        itemId: id,
        ops: [{ baseHash: "seen", block: paragraph("p1", "typed"), op: "put" }],
      }),
    ).resolves.toStrictEqual({ kind: "waiting" });
  });

  it("names every item a link can open, by id and by title", async () => {
    const { id, ports } = await phoneWithNote();
    await expect(ports.linkTargets({})).resolves.toStrictEqual({
      targets: [{ id, title: "Plans" }],
    });
  });

  it("answers a file the cache holds as the type it was kept as, and none for one it cannot reach", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    // a recording's first bytes, which name no type a sniff of a picture or a PDF knows
    const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const picture = fileSha(PNG);
    const recording = fileSha(MP4);
    const ports = createItemPorts({
      files: heldFiles(
        new Map([
          [picture, { bytes: PNG, mime: "image/png" }],
          [recording, { bytes: MP4, mime: "video/mp4" }],
        ]),
      ),
      replica: phone.replica,
    });
    await expect(ports.readFile({ sha: picture })).resolves.toStrictEqual({
      file: { base64: btoa(String.fromCodePoint(...PNG)), mediaType: "image/png" },
    });
    await expect(ports.readFile({ sha: recording })).resolves.toStrictEqual({
      file: { base64: btoa(String.fromCodePoint(...MP4)), mediaType: "video/mp4" },
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
    const ports = createItemPorts({ files: heldFiles(), replica: phone.replica });

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

  it("makes a note beside a card the library already held in that item's folder", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const folders = { held: mac.newId(), named: mac.newId() };
    await mac.replica.writeFolders([
      { id: folders.held, name: "Reading", op: "create", parentId: null, sort: "a0" },
      { id: folders.named, name: "Later", op: "create", parentId: null, sort: "a1" },
    ]);
    const url = "https://example.com/article";
    await mac.replica.saveLink({ folderId: folders.held, tags: [], url });
    await mac.replica.sync();
    const phone = await openDevice(cell, "phone");
    const card = await phone.replica.saveLink({ folderId: folders.named, tags: [], url });
    await phone.replica.sync();
    const ports = createItemPorts({ files: heldFiles(), replica: phone.replica });

    const { id } = await ports.createNote({
      besideId: card.id,
      blocks: [{ block: paragraph("p2", "moved"), ord: "a0" }],
      title: "moved",
    });

    expect(phone.replica.row(id)?.fields).toMatchObject({ folderId: folders.held });
  });
});
