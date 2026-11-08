import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { FakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, textOf } from "@repo/library-replica/test-support/replica-harness";
import { describe, expect, it } from "vitest";
import { sharedSaveOf } from "./share-payload";
import type { SharedSave } from "./share-payload";
import { saveShared } from "./share-save";

const URL = "https://stephango.com/file-over-app";

const noteOf = (cell: FakeCell, id: string): string[] =>
  [...(cell.item(id)?.blocks.values() ?? [])]
    .filter(({ section }) => section === "note")
    .map(({ block }) => textOf(block));

const idOf = (saved: Awaited<ReturnType<typeof saveShared>>): string =>
  saved?.kind === "saved" ? saved.made.id : "";

const phone = async () => {
  const cell = createFakeCell();
  const device = await openDevice(cell, "phone");
  let ids = 0;
  const newBlockId = (): string => {
    ids += 1;
    return `b${String(ids)}`;
  };
  return { args: { newBlockId, replica: device.replica }, cell, device };
};

describe("a share under a sign-out", () => {
  it.each([
    ["a link", { kind: "link", note: null, title: null, url: URL }],
    ["a thought", { kind: "text", text: "Look at this" }],
  ] satisfies [string, SharedSave][])(
    "says the library left and lays nothing when %s lands after the wipe",
    async (_case, shared) => {
      const { args, cell, device } = await phone();
      await device.replica.sync();
      await device.replica.wipe();
      await expect(saveShared(args, shared)).resolves.toStrictEqual({ kind: "left" });
      const next = await openDevice(cell, "phone", {
        blobs: device.blobs,
        network: device.network,
        sql: device.sql,
      });
      expect(next.replica.status().unsent).toBe(0);
      await next.replica.close();
    },
  );
});

describe("a share, saved", () => {
  it("saves the link for the cloud to read, the words beside it its note", async () => {
    const { args, cell, device } = await phone();
    const saved = await saveShared(args, {
      kind: "link",
      note: "For Tuesday.",
      title: "File over app",
      url: URL,
    });
    await device.replica.sync();
    expect(cell.calls).toContain("phone library/items/saveLink");
    expect(cell.calls).not.toContain("phone library/items/save");
    expect(cell.item(idOf(saved))?.fields).toMatchObject({ fetchState: "pending", url: URL });
    expect(noteOf(cell, idOf(saved))).toStrictEqual(["For Tuesday."]);
  });

  it("saves a title longer than an item's, clipped", async () => {
    const { args, cell, device } = await phone();
    const saved = await saveShared(
      args,
      sharedSaveOf({
        meta: { title: "t".repeat(ITEM_FIELD_CAPS.line + 1) },
        text: URL,
        webUrl: URL,
      }),
    );
    await device.replica.sync();
    expect(cell.item(idOf(saved))?.fields.title).toHaveLength(ITEM_FIELD_CAPS.line);
  });

  it("names an unread link by its address or the sheet's title, the words staying its note", async () => {
    const { args, cell, device } = await phone();
    const bare = await saveShared(
      args,
      sharedSaveOf({ meta: null, text: `Look at this ${URL}`, webUrl: URL }),
    );
    const titled = await saveShared(
      args,
      sharedSaveOf({
        meta: { title: "File over app" },
        text: "Look at this https://example.com/a",
        webUrl: "https://example.com/a",
      }),
    );
    await device.replica.sync();
    expect(cell.item(idOf(bare))?.fields.title).toBe("stephango.com - file over app");
    expect(noteOf(cell, idOf(bare))).toStrictEqual(["Look at this"]);
    expect(cell.item(idOf(titled))?.fields.title).toBe("File over app");
    expect(noteOf(cell, idOf(titled))).toStrictEqual(["Look at this"]);
  });

  it("answers a link the library holds with that item, the words beside it landing nowhere", async () => {
    const { args, cell, device } = await phone();
    const held = await saveShared(args, { kind: "link", note: null, title: null, url: URL });
    await device.replica.sync();
    const id = idOf(held);
    const saved = await saveShared(
      args,
      sharedSaveOf({ meta: null, text: `Look at this ${URL}`, webUrl: URL }),
    );
    await device.replica.sync();
    expect(saved).toMatchObject({ kind: "saved", made: { created: false, id } });
    expect(noteOf(cell, id)).toStrictEqual([]);
  });

  it("keeps shared text as a thought, and saves nothing for a share that held none", async () => {
    const { args, device } = await phone();
    const thought = await saveShared(args, { kind: "text", text: "Call the printer\n\nabout it" });
    const item = await device.replica.item(idOf(thought));
    expect(item?.fields.title).toBe("Call the printer");
    expect(item?.blocks.map(({ block }) => block.id)).toStrictEqual(["b1", "b2"]);
    await expect(saveShared(args, { kind: "nothing" })).resolves.toBeNull();
  });
});
