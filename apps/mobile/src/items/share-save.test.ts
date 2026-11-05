import type { FillAnswer, FillJob } from "@repo/editor-bridge/protocol";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph } from "@repo/library-replica/test-support/replica-harness";
import { describe, expect, it } from "vitest";
import type { PageFetch } from "./page-fetch";
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
      declaredBytes: null,
      mediaType: "text/html",
      truncated: false,
      url: request.url,
    },
  });

const offline: PageFetch = async () => await Promise.reject(new TypeError("the phone is offline"));

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
    expect(item?.blocks.map(({ block }) => block.id)).toEqual(["b1", "b2"]);
    expect(await saveShared(args, { kind: "nothing" })).toBeNull();
  });
});
