import type { FillAnswer, FillJob } from "@repo/editor-bridge/protocol";
import { fileSha } from "@repo/library-replica/library-replica";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { FakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph, textOf } from "@repo/library-replica/test-support/replica-harness";
import { describe, expect, it } from "vitest";
import type { PageFetch } from "./page-fetch";
import { deferred } from "../test-support/async";
import { sharedSaveOf } from "./share-payload";
import type { SharedSave } from "./share-payload";
import { saveShared } from "./share-save";

const URL = "https://stephango.com/file-over-app";

const READ: FillAnswer = {
  article: [{ block: paragraph("a1", "File over app is a philosophy."), ord: "a0" }],
  facts: {
    author: " Steph Ango ",
    description: null,
    images: [],
    lang: "en",
    oembed: null,
    published: null,
    site: "Steph Ango",
    title: "File over app",
  },
  kept: 1,
  kind: "read",
  rung: "rich",
};

// a page the phone fetched itself, as the page fetch answers it
const servingPage: PageFetch = async (request) =>
  await Promise.resolve({
    ok: true,
    page: {
      bytes: new TextEncoder().encode("<h1>File over app</h1>"),
      charset: "utf-8",
      mediaType: "text/html",
      url: request.url,
    },
  });

const offline: PageFetch = async () => await Promise.reject(new TypeError("the phone is offline"));

// a PNG's signature and IHDR, which name its size whatever the rest of the file holds
const pngOf = (width: number, height: number): Uint8Array<ArrayBuffer> => {
  const head = new Uint8Array(24);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
};

const noteOf = (cell: FakeCell, id: string): string[] =>
  [...(cell.item(id)?.blocks.values() ?? [])]
    .filter(({ section }) => section === "note")
    .map(({ block }) => textOf(block));

const phone = async () => {
  const cell = createFakeCell();
  const device = await openDevice(cell, "phone");
  let ids = 0;
  const newBlockId = (): string => {
    ids += 1;
    return `b${String(ids)}`;
  };
  return { cell, device, newBlockId };
};

describe("a share under a sign-out", () => {
  it.each([
    ["a page it read", { kind: "link", note: null, title: null, url: URL }],
    ["a thought", { kind: "text", text: "Look at this" }],
  ] satisfies [string, SharedSave][])(
    "says the library left and lays nothing when %s lands after the wipe",
    async (_case, shared) => {
      const { cell, device, newBlockId } = await phone();
      await device.replica.sync();
      const reading = deferred();
      const saving = saveShared(
        {
          newBlockId,
          ports: {
            fetch: async (request) => {
              await reading.promise;
              return await servingPage(request);
            },
            read: async () => await Promise.resolve(READ),
          },
          replica: device.replica,
        },
        shared,
      );
      await device.replica.wipe();
      reading.resolve();
      await expect(saving).resolves.toStrictEqual({ kind: "left" });
      expect(device.blobs.held()).toStrictEqual([]);
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
  it("reads a shared page on the phone and saves it read, its facts and article with it", async () => {
    const { cell, device, newBlockId } = await phone();
    const jobs: FillJob[] = [];
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: servingPage,
          read: async (job) => {
            jobs.push(job);
            return await Promise.resolve(READ);
          },
        },
        replica: device.replica,
      },
      { kind: "link", note: null, title: null, url: URL },
    );
    expect(jobs).toMatchObject([{ charset: "utf-8", prefer: "article", url: URL }]);
    expect(saved?.kind).toBe("saved");
    await device.replica.sync();
    const id = saved?.kind === "saved" ? saved.made.id : "";
    expect(cell.item(id)?.fields).toMatchObject({
      author: "Steph Ango",
      site: "Steph Ango",
      title: "File over app",
      url: URL,
    });
    expect(cell.calls).toContain("phone library/items/save");
  });

  it("keeps the words shared beside a page it reads as the item's note", async () => {
    const { cell, device, newBlockId } = await phone();
    const saved = await saveShared(
      {
        newBlockId,
        ports: { fetch: servingPage, read: async () => await Promise.resolve(READ) },
        replica: device.replica,
      },
      sharedSaveOf({ meta: null, text: `Look at this ${URL}`, webUrl: URL }),
    );
    await device.replica.sync();
    expect(cell.calls).toContain("phone library/items/save");
    const id = saved?.kind === "saved" ? saved.made.id : "";
    expect(cell.item(id)?.fields.title).toBe("File over app");
    expect(noteOf(cell, id)).toStrictEqual(["Look at this"]);
  });

  it("adds no note of words that only say the page's own title again", async () => {
    const { cell, device, newBlockId } = await phone();
    const saved = await saveShared(
      {
        newBlockId,
        ports: { fetch: servingPage, read: async () => await Promise.resolve(READ) },
        replica: device.replica,
      },
      sharedSaveOf({ meta: null, text: `File over app\n${URL}`, webUrl: URL }),
    );
    await device.replica.sync();
    expect(noteOf(cell, saved?.kind === "saved" ? saved.made.id : "")).toStrictEqual([]);
  });

  it("judges a shared page's cover as every device does, passing over one too big to decode", async () => {
    const { cell, device, newBlockId } = await phone();
    const pictures = new Map([
      ["https://stephango.com/big.png", pngOf(30_000, 30_000)],
      ["https://stephango.com/cover.png", pngOf(1200, 630)],
    ]);
    const fetch: PageFetch = async (request) => {
      const picture = pictures.get(request.url);
      return picture === undefined
        ? await servingPage(request)
        : await Promise.resolve({
            ok: true,
            page: {
              bytes: picture,
              charset: null,
              mediaType: "image/png",
              url: request.url,
            },
          });
    };
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch,
          read: async () =>
            await Promise.resolve({
              ...READ,
              facts: { ...READ.facts, images: [...pictures.keys()] },
            }),
        },
        replica: device.replica,
      },
      { kind: "link", note: null, title: null, url: URL },
    );
    await device.replica.sync();
    const id = saved?.kind === "saved" ? saved.made.id : "";
    expect(cell.item(id)?.fields.coverSha).toBe(fileSha(pngOf(1200, 630)));
  });

  it("saves the link for the cloud to read when the phone cannot read it now", async () => {
    const { cell, device, newBlockId } = await phone();
    const saved = await saveShared(
      {
        newBlockId,
        ports: { fetch: offline, read: async () => await Promise.resolve(READ) },
        replica: device.replica,
      },
      { kind: "link", note: "For Tuesday.", title: "File over app", url: URL },
    );
    expect(saved?.kind).toBe("saved");
    await device.replica.sync();
    expect(cell.calls).toContain("phone library/items/saveLink");
    expect(noteOf(cell, saved?.kind === "saved" ? saved.made.id : "")).toStrictEqual([
      "For Tuesday.",
    ]);
  });

  it("names an unread link by short words shared beside it, whichever came with its title", async () => {
    const { cell, device, newBlockId } = await phone();
    const args = {
      newBlockId,
      ports: { fetch: offline, read: async () => await Promise.resolve(READ) },
      replica: device.replica,
    };
    const named = await saveShared(
      args,
      sharedSaveOf({ meta: null, text: `Look at this ${URL}`, webUrl: URL }),
    );
    await device.replica.sync();
    const id = named?.kind === "saved" ? named.made.id : "";
    expect(cell.item(id)?.fields.title).toBe("Look at this");
    expect(noteOf(cell, id)).toStrictEqual([]);
  });

  it("keeps shared text as a thought, and saves nothing for a share that held none", async () => {
    const { device, newBlockId } = await phone();
    const args = {
      newBlockId,
      ports: { fetch: offline, read: async () => await Promise.resolve(READ) },
      replica: device.replica,
    };
    const thought = await saveShared(args, { kind: "text", text: "Call the printer\n\nabout it" });
    const id = thought?.kind === "saved" ? thought.made.id : "";
    const item = await device.replica.item(id);
    expect(item?.fields.title).toBe("Call the printer");
    expect(item?.blocks.map(({ block }) => block.id)).toStrictEqual(["b1", "b2"]);
    await expect(saveShared(args, { kind: "nothing" })).resolves.toBeNull();
  });
});
