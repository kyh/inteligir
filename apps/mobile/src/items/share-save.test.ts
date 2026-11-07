import type { FillAnswer, FillJob } from "@repo/editor-bridge/protocol";
import { fileSha } from "@repo/library-replica/library-replica";
import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { FakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph, textOf } from "@repo/library-replica/test-support/replica-harness";
import { describe, expect, it } from "vitest";
import { createPageFetch } from "./page-fetch";
import type { PageFetch } from "./page-fetch";
import { deferred } from "../test-support/async";
import { sharedSaveOf } from "./share-payload";
import type { SharedSave } from "./share-payload";
import { saveShared } from "./share-save";
import type { ShareReadPorts } from "./share-save";

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
  kind: "read",
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

const offline: PageFetch = async () => await Promise.resolve({ ok: false });

const portsOf = (fetch: PageFetch, answer: FillAnswer = READ): ShareReadPorts => ({
  fetch,
  read: async () => await Promise.resolve(answer),
});

// the phone's own fetch, over a web where one address redirects to a page
const redirecting = (from: string, to: string): PageFetch =>
  createPageFetch(
    async (url) =>
      await Promise.resolve(
        url === from
          ? new Response(null, { headers: { location: to }, status: 301 })
          : new Response("<h1>File over app</h1>", { headers: { "content-type": "text/html" } }),
      ),
    { acceptLanguage: "en-US", userAgent: "inteligir-test" },
  );

// the phone's own fetch over a web of redirects, which keeps what it was asked
const walking = (hops: ReadonlyMap<string, string>) => {
  const asked: string[] = [];
  const fetch = createPageFetch(
    async (url) => {
      asked.push(url);
      const location = hops.get(url);
      return await Promise.resolve(
        location === undefined
          ? new Response("<h1>File over app</h1>", { headers: { "content-type": "text/html" } })
          : new Response(null, { headers: { location }, status: 302 }),
      );
    },
    { acceptLanguage: "en-US", userAgent: "inteligir-test" },
  );
  return { asked, fetch };
};

const coverNamed = (url: string): FillAnswer => ({
  ...READ,
  facts: { ...READ.facts, images: [url] },
});

// a PNG's signature and IHDR, which name its size whatever the rest of the file holds
const pngOf = (width: number, height: number): Uint8Array<ArrayBuffer> => {
  const head = new Uint8Array(24);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
};

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

const noteOf = (cell: FakeCell, id: string): string[] =>
  [...(cell.item(id)?.blocks.values() ?? [])]
    .filter(({ section }) => section === "note")
    .map(({ block }) => textOf(block));

const idOf = (saved: Awaited<ReturnType<typeof saveShared>>): string =>
  saved?.kind === "saved" ? saved.made.id : "";

const articleOf = (cell: FakeCell, id: string): string[] =>
  [...(cell.item(id)?.blocks.values() ?? [])]
    .filter(({ section }) => section === "article")
    .map(({ block }) => textOf(block));

// where the cloud's reading of an item stands, written as a device writes a field
const stateOf = (value: LibraryItemFields["fetchState"], base: LibraryItemFields["fetchState"]) =>
  ({ base, field: "fetchState", op: "set", value }) as const;

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

describe("a share's walk through private space", () => {
  const PRIVATE = "http://go/x";
  const PUBLIC = "https://public.example.com/a";
  const ROUTER = "http://10.0.0.5/admin";
  const CAMERA = "http://10.0.0.5/cam.png";

  it.each([
    [
      "from private space through a public page",
      PRIVATE,
      new Map([
        [PRIVATE, PUBLIC],
        [PUBLIC, ROUTER],
      ]),
      [PRIVATE, PUBLIC],
    ],
    ["from a public page", PUBLIC, new Map([[PUBLIC, ROUTER]]), [PUBLIC]],
  ])("takes no step into private space %s", async (_case, start, hops, reached) => {
    const { device, newBlockId } = await phone();
    const { asked, fetch } = walking(hops);
    await saveShared(
      { newBlockId, ports: portsOf(fetch), replica: device.replica },
      { kind: "link", note: null, title: null, url: start },
    );
    expect(asked).toStrictEqual(reached);
  });

  it("walks from private space on through private space, and asks a cover there", async () => {
    const { device, newBlockId } = await phone();
    const { asked, fetch } = walking(new Map([[PRIVATE, ROUTER]]));
    await saveShared(
      { newBlockId, ports: portsOf(fetch, coverNamed(CAMERA)), replica: device.replica },
      { kind: "link", note: null, title: null, url: PRIVATE },
    );
    expect(asked).toStrictEqual([PRIVATE, ROUTER, CAMERA]);
  });

  it("asks no cover in private space of a public page a private address led to", async () => {
    const { device, newBlockId } = await phone();
    const { asked, fetch } = walking(new Map([[PRIVATE, PUBLIC]]));
    await saveShared(
      { newBlockId, ports: portsOf(fetch, coverNamed(CAMERA)), replica: device.replica },
      { kind: "link", note: null, title: null, url: PRIVATE },
    );
    expect(asked).toStrictEqual([PRIVATE, PUBLIC]);
  });
});

describe("a share whose address moved", () => {
  const SHORT = "https://bit.ly/x";
  const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const WALL = "https://stephango.com/login?next=/file-over-app";
  const WALL_READ: FillAnswer = {
    ...READ,
    article: [{ block: paragraph("w1", "Log in to keep reading."), ord: "a0" }],
    facts: { ...READ.facts, title: "Log in" },
  };
  const LINK = { kind: "link", note: null, title: null } as const;

  const heldRead = async (held: Awaited<ReturnType<typeof phone>>) => {
    const saved = await saveShared(
      { ...held, ports: portsOf(servingPage), replica: held.device.replica },
      { ...LINK, url: URL },
    );
    await held.device.replica.sync();
    return idOf(saved);
  };

  const heldUnread = async (held: Awaited<ReturnType<typeof phone>>, url: string) => {
    const saved = await saveShared(
      { ...held, ports: portsOf(offline), replica: held.device.replica },
      { ...LINK, url },
    );
    await held.device.replica.sync();
    return idOf(saved);
  };

  it("adds the words to the article it holds there and reads nothing of the wall", async () => {
    const held = await phone();
    const { cell, device, newBlockId } = held;
    const id = await heldRead(held);
    const jobs: FillJob[] = [];
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: redirecting(URL, WALL),
          read: async (job) => {
            jobs.push(job);
            return await Promise.resolve(WALL_READ);
          },
        },
        replica: device.replica,
      },
      { ...LINK, note: "Worth keeping", url: URL },
    );
    await device.replica.sync();
    expect(saved).toMatchObject({ kind: "saved", made: { folded: true, id } });
    expect(jobs).toStrictEqual([]);
    expect(cell.calls.filter((call) => call === "phone library/items/save")).toHaveLength(1);
    expect(cell.calls).toContain("phone library/items/saveLink");
    expect(articleOf(cell, id)).toStrictEqual(["File over app is a philosophy."]);
    expect(noteOf(cell, id)).toStrictEqual(["Worth keeping"]);
  });

  it.each([
    ["waits for the cloud", null],
    ["the cloud failed to read", stateOf("failed", "pending")],
  ])("reads a page into the item there that %s", async (_case, op) => {
    const held = await phone();
    const { cell, device, newBlockId } = held;
    const id = await heldUnread(held, SHORT);
    if (op !== null) {
      await device.replica.write(id, { ops: [op] });
      await device.replica.sync();
    }
    const saved = await saveShared(
      { newBlockId, ports: portsOf(redirecting(SHORT, URL)), replica: device.replica },
      { ...LINK, note: "Worth keeping", url: SHORT },
    );
    await device.replica.sync();
    expect(saved).toMatchObject({ kind: "saved", made: { folded: true, id } });
    expect(cell.calls).toContain("phone library/items/save");
    expect(noteOf(cell, id)).toStrictEqual(["Worth keeping"]);
  });

  it.each([
    ["waiting to be read again", stateOf("pending", "filled")],
    ["whose reading again failed", stateOf("failed", "filled")],
  ])("leaves the article of an item %s", async (_case, op) => {
    const held = await phone();
    const { cell, device, newBlockId } = held;
    const id = await heldRead(held);
    await device.replica.write(id, { ops: [op] });
    await device.replica.sync();
    await saveShared(
      { newBlockId, ports: portsOf(redirecting(URL, WALL), WALL_READ), replica: device.replica },
      { ...LINK, url: URL },
    );
    await device.replica.sync();
    expect(cell.calls.filter((call) => call === "phone library/items/save")).toHaveLength(1);
    expect(articleOf(cell, id)).toStrictEqual(["File over app is a philosophy."]);
  });

  it.each([["filled"], ["none"]] as const)(
    "reads nothing into an item there the cloud calls %s",
    async (state) => {
      const held = await phone();
      const { cell, device, newBlockId } = held;
      const id = await heldUnread(held, SHORT);
      await device.replica.write(id, { ops: [stateOf(state, "pending")] });
      await device.replica.sync();
      await saveShared(
        {
          newBlockId,
          ports: portsOf(redirecting(SHORT, WALL), WALL_READ),
          replica: device.replica,
        },
        { ...LINK, url: SHORT },
      );
      await device.replica.sync();
      expect(cell.calls).not.toContain("phone library/items/save");
    },
  );

  it("reads nothing into an item whose body has yet to arrive, since it may hold an article", async () => {
    const held = await phone();
    const { cell, newBlockId } = held;
    const id = await heldRead(held);
    await held.device.replica.write(id, { ops: [stateOf("failed", "filled")] });
    await held.device.replica.sync();
    cell.setBodiesPerAnswer(0);
    const second = await openDevice(cell, "second phone");
    await second.replica.sync();
    await saveShared(
      { newBlockId, ports: portsOf(redirecting(URL, WALL), WALL_READ), replica: second.replica },
      { ...LINK, url: URL },
    );
    await second.replica.sync();
    expect(cell.calls).not.toContain("second phone library/items/save");
    expect(cell.calls).toContain("second phone library/items/saveLink");
  });

  it.each([
    ["unread", null],
    ["read", stateOf("filled", "pending")],
  ])("makes no second item of a short link held %s that lands on a video", async (_case, op) => {
    const held = await phone();
    const { cell, device, newBlockId } = held;
    const short = "https://t.co/x";
    const id = await heldUnread(held, short);
    if (op !== null) {
      await device.replica.write(id, { ops: [op] });
      await device.replica.sync();
    }
    const saved = await saveShared(
      { newBlockId, ports: portsOf(redirecting(short, VIDEO)), replica: device.replica },
      { ...LINK, note: "Worth keeping", url: short },
    );
    await device.replica.sync();
    expect(saved).toMatchObject({ kind: "saved", made: { folded: true, id } });
    expect(cell.items().size).toBe(1);
    expect(noteOf(cell, id)).toStrictEqual(["Worth keeping"]);
  });

  it("names a save that stays at the shared address by the sheet's title, since a wall names itself", async () => {
    const { cell, device, newBlockId } = await phone();
    const saved = await saveShared(
      { newBlockId, ports: portsOf(redirecting(URL, WALL), WALL_READ), replica: device.replica },
      { ...LINK, title: "The real post", url: URL },
    );
    await device.replica.sync();
    expect(cell.item(idOf(saved))?.fields).toMatchObject({ title: "The real post", url: URL });
  });

  it("names a save at the landed address, and one that never moved, by what it read", async () => {
    const { cell, device, newBlockId } = await phone();
    const video = await saveShared(
      { newBlockId, ports: portsOf(redirecting(SHORT, VIDEO)), replica: device.replica },
      { ...LINK, title: "bit.ly", url: SHORT },
    );
    const page = await saveShared(
      { newBlockId, ports: portsOf(servingPage), replica: device.replica },
      { ...LINK, title: "From the sheet", url: URL },
    );
    await device.replica.sync();
    expect(cell.item(idOf(video))?.fields).toMatchObject({ title: "File over app", url: VIDEO });
    expect(cell.item(idOf(page))?.fields).toMatchObject({ title: "File over app", url: URL });
  });

  it.each([
    ["a video", `${VIDEO}&t=${"1".repeat(ITEM_FIELD_CAPS.url)}`],
    ["a page the library holds", `${URL}?utm_content=${"1".repeat(ITEM_FIELD_CAPS.url)}`],
  ])("stays at the shared address when %s lands past an item's address", async (_case, landed) => {
    const held = await phone();
    const { cell, device, newBlockId } = held;
    await heldRead(held);
    const saved = await saveShared(
      { newBlockId, ports: portsOf(redirecting(SHORT, landed)), replica: device.replica },
      { ...LINK, url: SHORT },
    );
    await device.replica.sync();
    expect(cell.item(idOf(saved))?.fields.url).toBe(SHORT);
  });

  it("saves a title longer than an item's, clipped, whether or not it read the page", async () => {
    const { cell, device, newBlockId } = await phone();
    const saved = await saveShared(
      { newBlockId, ports: portsOf(offline), replica: device.replica },
      sharedSaveOf({
        meta: { title: "t".repeat(ITEM_FIELD_CAPS.line + 1) },
        text: URL,
        webUrl: URL,
      }),
    );
    await device.replica.sync();
    expect(cell.item(idOf(saved))?.fields.title).toHaveLength(ITEM_FIELD_CAPS.line);
  });
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

  it("reads a shared video for its description, as every device does", async () => {
    const { device, newBlockId } = await phone();
    const jobs: FillJob[] = [];
    await saveShared(
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
      { kind: "link", note: null, title: null, url: "https://www.youtube.com/watch?v=abc123" },
    );
    expect(jobs).toMatchObject([{ prefer: "description" }]);
  });

  it("saves the link for the cloud to read when the page named itself and held no text", async () => {
    const { cell, device, newBlockId } = await phone();
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: servingPage,
          read: async () => await Promise.resolve({ ...READ, article: [] }),
        },
        replica: device.replica,
      },
      { kind: "link", note: null, title: "A post", url: "https://x.com/kyh/status/1" },
    );
    expect(saved?.kind).toBe("saved");
    await device.replica.sync();
    expect(cell.calls).toContain("phone library/items/saveLink");
    expect(cell.calls).not.toContain("phone library/items/save");
  });

  it.each([
    ["a PDF that declared no type", PDF, null],
    ["a PDF served as a page", PDF, "text/html"],
    ["a picture that declared no type", pngOf(1200, 630), null],
  ])(
    "saves the link for the cloud to keep the file when the answer is %s",
    async (_, bytes, type) => {
      const { cell, device, newBlockId } = await phone();
      const jobs: FillJob[] = [];
      const saved = await saveShared(
        {
          newBlockId,
          ports: {
            fetch: async (request) =>
              await Promise.resolve({
                ok: true,
                page: { bytes, charset: null, mediaType: type, url: request.url },
              }),
            read: async (job) => {
              jobs.push(job);
              return await Promise.resolve(READ);
            },
          },
          replica: device.replica,
        },
        { kind: "link", note: null, title: null, url: URL },
      );
      expect(saved?.kind).toBe("saved");
      await device.replica.sync();
      expect(jobs).toStrictEqual([]);
      expect(cell.calls).toContain("phone library/items/saveLink");
      expect(cell.calls).not.toContain("phone library/items/save");
    },
  );

  it("reads an address that moved here, and the item keeps the address it was shared at", async () => {
    const { cell, device, newBlockId } = await phone();
    const jobs: FillJob[] = [];
    const short = "https://bit.ly/x";
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: redirecting(short, URL),
          read: async (job) => {
            jobs.push(job);
            return await Promise.resolve(READ);
          },
        },
        replica: device.replica,
      },
      sharedSaveOf({ meta: null, text: `Look at this ${short}`, webUrl: short }),
    );
    await device.replica.sync();
    expect(jobs.map(({ url }) => url)).toStrictEqual([URL]);
    expect(cell.calls).toContain("phone library/items/save");
    const id = saved?.kind === "saved" ? saved.made.id : "";
    expect(cell.item(id)?.fields).toMatchObject({ title: "File over app", url: short });
    expect(noteOf(cell, id)).toStrictEqual(["Look at this"]);
  });

  it("saves a page that moved at the address the library holds, so it joins that item", async () => {
    const { cell, device, newBlockId } = await phone();
    const ports = { fetch: servingPage, read: async () => await Promise.resolve(READ) };
    const first = await saveShared(
      { newBlockId, ports, replica: device.replica },
      { kind: "link", note: null, title: null, url: URL },
    );
    await device.replica.sync();
    const short = "https://bit.ly/x";
    const saved = await saveShared(
      {
        newBlockId,
        ports: { ...ports, fetch: redirecting(short, URL) },
        replica: device.replica,
      },
      { kind: "link", note: "Worth keeping", title: null, url: short },
    );
    await device.replica.sync();
    const held = first?.kind === "saved" ? first.made.id : "";
    expect(saved).toMatchObject({ kind: "saved", made: { folded: true, id: held } });
    expect(noteOf(cell, held)).toStrictEqual(["Worth keeping"]);
    expect(cell.item(held)?.fields.url).toBe(URL);
  });

  it("takes the address a link turned out a video at, and reads it for its description", async () => {
    const { cell, device, newBlockId } = await phone();
    const jobs: FillJob[] = [];
    const short = "https://t.co/x";
    const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: redirecting(short, video),
          read: async (job) => {
            jobs.push(job);
            return await Promise.resolve(READ);
          },
        },
        replica: device.replica,
      },
      { kind: "link", note: null, title: null, url: short },
    );
    await device.replica.sync();
    expect(jobs.map(({ prefer }) => prefer)).toStrictEqual(["description"]);
    const id = saved?.kind === "saved" ? saved.made.id : "";
    expect(cell.item(id)?.fields).toMatchObject({ kind: "video", url: video });
  });

  it("keeps the address of a video that moved to a wall of no kind", async () => {
    const { cell, device, newBlockId } = await phone();
    const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: redirecting(video, "https://consent.example.com/?continue=1"),
          read: async () => await Promise.resolve(READ),
        },
        replica: device.replica,
      },
      { kind: "link", note: null, title: null, url: video },
    );
    await device.replica.sync();
    const id = saved?.kind === "saved" ? saved.made.id : "";
    expect(cell.item(id)?.fields).toMatchObject({ kind: "video", url: video });
  });

  it("leaves a moved page it found no text in to the cloud, the words staying the note", async () => {
    const { cell, device, newBlockId } = await phone();
    const short = "https://bit.ly/x";
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: redirecting(short, URL),
          read: async () => await Promise.resolve({ ...READ, article: [] }),
        },
        replica: device.replica,
      },
      sharedSaveOf({ meta: null, text: `Look at this ${short}`, webUrl: short }),
    );
    await device.replica.sync();
    expect(cell.calls).toContain("phone library/items/saveLink");
    const id = saved?.kind === "saved" ? saved.made.id : "";
    expect(cell.item(id)?.fields.title).not.toBe("Look at this");
    expect(noteOf(cell, id)).toStrictEqual(["Look at this"]);
  });

  it("reads an address in private space here wherever it moved, the fill never reaching it", async () => {
    const { cell, device, newBlockId } = await phone();
    const home = "http://nas.local/";
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: redirecting(home, "http://nas.local/login"),
          read: async () => await Promise.resolve(READ),
        },
        replica: device.replica,
      },
      { kind: "link", note: null, title: null, url: home },
    );
    await device.replica.sync();
    expect(cell.calls).toContain("phone library/items/save");
    expect(cell.item(saved?.kind === "saved" ? saved.made.id : "")?.fields.url).toBe(home);
  });

  it("reads an address that only changed its spelling on the way, as itself", async () => {
    const { cell, device, newBlockId } = await phone();
    const bare = "https://stephango.com/file-over-app/";
    const www = "https://www.stephango.com/file-over-app";
    const saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: redirecting(bare, www),
          read: async () => await Promise.resolve(READ),
        },
        replica: device.replica,
      },
      { kind: "link", note: null, title: null, url: bare },
    );
    await device.replica.sync();
    expect(cell.calls).toContain("phone library/items/save");
    expect(cell.item(saved?.kind === "saved" ? saved.made.id : "")?.fields.url).toBe(bare);
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

  it("names an unread link by its address or the sheet's title, the words staying its note", async () => {
    const { cell, device, newBlockId } = await phone();
    const args = {
      newBlockId,
      ports: { fetch: offline, read: async () => await Promise.resolve(READ) },
      replica: device.replica,
    };
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
    const bareId = bare?.kind === "saved" ? bare.made.id : "";
    const titledId = titled?.kind === "saved" ? titled.made.id : "";
    expect(cell.item(bareId)?.fields.title).toBe("stephango.com - file over app");
    expect(noteOf(cell, bareId)).toStrictEqual(["Look at this"]);
    expect(cell.item(titledId)?.fields.title).toBe("File over app");
    expect(noteOf(cell, titledId)).toStrictEqual(["Look at this"]);
  });

  it.each([
    ["offline", offline, READ],
    ["with no article", servingPage, { ...READ, article: [] }],
  ])("adds the words to the item holding the address, saved %s", async (_case, fetch, answer) => {
    const { cell, device, newBlockId } = await phone();
    const held = await saveShared(
      {
        newBlockId,
        ports: { fetch: servingPage, read: async () => await Promise.resolve(READ) },
        replica: device.replica,
      },
      { kind: "link", note: null, title: null, url: URL },
    );
    await device.replica.sync();
    const id = held?.kind === "saved" ? held.made.id : "";
    const saved = await saveShared(
      {
        newBlockId,
        ports: { fetch, read: async () => await Promise.resolve(answer) },
        replica: device.replica,
      },
      sharedSaveOf({ meta: null, text: `Look at this ${URL}`, webUrl: URL }),
    );
    await device.replica.sync();
    expect(saved).toMatchObject({ kind: "saved", made: { folded: true, id } });
    expect(cell.calls).toContain("phone library/items/saveLink");
    expect(noteOf(cell, id)).toStrictEqual(["Look at this"]);
    expect(cell.item(id)?.fields.title).toBe("File over app");
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
