// The note page's actions as they cross into the page: answered over the phone's runtime, signed in
// to the contract's fake cell, every answer read back as the JSON Expo carries, bytes as base64,
// and a refusal as the Error whose message the page is handed.

import { createHash } from "node:crypto";
import { base64FromBytes } from "@repo/contract/bytes";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import { paragraph } from "@repo/contract/test-support/library-items";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { composeRuntime } from "../lib/compose-runtime";
import { fakePhoneAuth } from "../test-support/fake-phone-auth";
import { memoryFolder } from "../test-support/memory-folder";
import { memoryKv } from "../test-support/memory-kv";
import { noteActions } from "./note-actions";

const NOTE = "0190a000-0000-7000-8000-0000000000a1";
const OTHER = "0190a000-0000-7000-8000-0000000000a2";
const PICTURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

const idSource = () => {
  let next = 0;
  return (): string => {
    next += 1;
    return `0190a000-0000-7000-8000-${next.toString(16).padStart(12, "0")}`;
  };
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

type Json = z.infer<ReturnType<typeof z.json>>;

// what the page is handed of an answer: Expo carries each one as JSON text
const overTheWire = async (answer: Promise<unknown>): Promise<Json> => {
  const text = JSON.stringify(await answer);
  return z.json().parse(JSON.parse(text));
};

// `changedBytes`: the phone hashes what it sends wrongly, as bytes that changed before they went
const pageOver = async (cell: FakeCell, { changedBytes = false } = {}) => {
  const network = cell.device("phone");
  const runtime = composeRuntime({
    auth: fakePhoneAuth().auth,
    build: { platform: "mobile", version: "1.0.0" },
    cloudUrl: "https://cell.test",
    fetch: async (request) => await network.transport.fetch(request),
    folder: memoryFolder(),
    newBlockId: idSource(),
    newId: idSource(),
    sha256Hex: async (bytes) =>
      await Promise.resolve(changedBytes ? sha256(Uint8Array.of(0)) : sha256(bytes)),
    shrinkCover: async () => await Promise.resolve(null),
    storage: memoryKv(),
    WebSocket: null,
  });
  await runtime.start();
  await runtime.login.login({ email: "ada@example.com", password: "a long password" });
  const session = runtime.session.get();
  if (session.kind !== "signed-in") {
    throw new Error(`the phone is ${session.kind}`);
  }
  const opened: string[] = [];
  const actions = noteActions({
    itemId: NOTE,
    library: session.library,
    openItem: (itemId) => {
      opened.push(itemId);
    },
    queryClient: runtime.queryClient,
  });
  return { actions, network, opened };
};

const noteFiled = async (cell: FakeCell, folderId: string | null): Promise<void> => {
  await cell.device("mac").client.library.items.create({
    blocks: [{ block: paragraph("p1", "first"), section: "note" }],
    folderId,
    id: NOTE,
    opId: "0190a000-0000-7000-8000-0000000000b1",
    savedAt: 1_700_000_000_000,
    tags: [],
    title: "Plans",
  });
};

describe("the note page's actions, as the page receives them", () => {
  it("answers an item's blocks, and none for an item the library holds none of", async () => {
    const cell = createFakeCell();
    await noteFiled(cell, null);
    const { actions } = await pageOver(cell);

    await expect(overTheWire(actions.readItem(NOTE))).resolves.toStrictEqual([
      paragraph("p1", "first"),
    ]);
    await expect(overTheWire(actions.readItem(OTHER))).resolves.toBeNull();
  });

  it("answers the blocks it last read while there is no connection, and refuses one it never read", async () => {
    const cell = createFakeCell();
    await noteFiled(cell, null);
    const { actions, network } = await pageOver(cell);
    await actions.readItem(NOTE);
    await actions.linkTargets();
    network.setOffline(true);

    await expect(overTheWire(actions.readItem(NOTE))).resolves.toStrictEqual([
      paragraph("p1", "first"),
    ]);
    await expect(overTheWire(actions.linkTargets())).resolves.toStrictEqual([
      { id: NOTE, title: "Plans" },
    ]);
    await expect(actions.readItem(OTHER)).rejects.toBeInstanceOf(Error);
  });

  it("names every item a link can, by its id and the title it goes by", async () => {
    const cell = createFakeCell();
    await noteFiled(cell, null);
    const { actions } = await pageOver(cell);

    await expect(overTheWire(actions.linkTargets())).resolves.toStrictEqual([
      { id: NOTE, title: "Plans" },
    ]);
  });

  it("sends a pasted file's base64 up as its bytes, and hands them back as they went", async () => {
    const cell = createFakeCell();
    const { actions, network } = await pageOver(cell);
    const file = { base64: base64FromBytes(PICTURE), mediaType: "image/png" };

    const kept = await overTheWire(actions.keepFile(file));

    expect(kept).toStrictEqual({ sha: sha256(PICTURE) });
    expect(cell.uploads).toStrictEqual([sha256(PICTURE)]);
    network.setOffline(true);
    await expect(overTheWire(actions.readFile(sha256(PICTURE)))).resolves.toStrictEqual(file);
  });

  it("reads a file another device sent once, and answers none for one nobody holds", async () => {
    const cell = createFakeCell();
    const mac = await pageOver(cell);
    const file = { base64: base64FromBytes(PICTURE), mediaType: "image/png" };
    await mac.actions.keepFile(file);
    const { actions } = await pageOver(cell);

    await expect(overTheWire(actions.readFile(sha256(PICTURE)))).resolves.toStrictEqual(file);
    await expect(overTheWire(actions.readFile(sha256(Uint8Array.of(9))))).resolves.toBeNull();
  });

  it("refuses a file the cloud did not take with the words why", async () => {
    const refusing = await pageOver(createFakeCell(), { changedBytes: true });
    const file = { base64: base64FromBytes(PICTURE), mediaType: "image/png" };

    await expect(refusing.actions.keepFile(file)).rejects.toThrow(
      new Error("This file changed on this device before it was sent."),
    );

    const offline = await pageOver(createFakeCell());
    offline.network.setOffline(true);
    await expect(offline.actions.keepFile(file)).rejects.toThrow(
      new Error("the file was not sent: unreachable"),
    );
  });

  it("makes a note the editor moves out in the open item's folder, and answers its id", async () => {
    const cell = createFakeCell();
    const folderId = cell.seed.folder("Work");
    await noteFiled(cell, folderId);
    const { actions } = await pageOver(cell);

    const made = await overTheWire(
      actions.createNote({ blocks: [paragraph("m1", "moved")], title: "Moved" }),
    );

    const note = cell.item(z.string().parse(made));
    expect(note?.fields.folderId).toBe(folderId);
    expect(note?.fields.title).toBe("Moved");
    expect(note?.blocks).toStrictEqual([{ block: paragraph("m1", "moved"), section: "note" }]);
  });

  it("fetches the note socket's ticket, and opens a followed link's item on the stack", async () => {
    const { actions, opened } = await pageOver(createFakeCell());

    await expect(overTheWire(actions.socketTicket())).resolves.toBe("a-ticket");
    actions.openItem(OTHER);
    expect(opened).toStrictEqual([OTHER]);
  });
});
