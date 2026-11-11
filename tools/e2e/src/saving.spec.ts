import { expect } from "@playwright/test";
import type { V1Client } from "@repo/contract/v1";
import { download, openLibrary, test } from "./fixtures";

// a PNG's head alone, of a cover's size: the fill reads a picture's size and decodes nothing
const coverOf = (width: number, height: number): Uint8Array<ArrayBuffer> => {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
};

const page = (title: string, head: string, article: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><nav><a href="/">Home</a></nav><article><h1>${title}</h1>${article}</article><footer>Written on a quiet afternoon.</footer></body></html>`;

const settled = async (library: V1Client["library"], id: string) => {
  const read = await library.items.read({ id });
  return read.fields.fetchState === "pending" ? null : read;
};

// the cover's sha, which only an item's whole row carries
const coverShaOf = async (library: V1Client["library"], id: string): Promise<string> => {
  const { fields } = await library.items.get({ id });
  return fields.coverSha ?? "";
};

test("a link pasted on the grid is read by the Worker's own fill, and saved again is the same item", async ({
  account,
  cloud,
  library,
  page: tab,
}) => {
  const cover = coverOf(640, 400);
  cloud.pages.set("/cover.png", { body: cover, type: "image/png" });
  cloud.pages.set("/essay", {
    body: page(
      "Keeping notes in plain files",
      '<meta property="og:site_name" content="The Example Journal"><meta name="description" content="Why a folder of text files outlasts every app."><meta name="author" content="Ada Example"><meta property="og:image" content="/cover.png">',
      "<p>A folder of text files outlasts every app that reads it. The files are yours, on your own disk.</p><h2>What lasts</h2><p>Plain text has been readable for fifty years, and nothing suggests that will change.</p>",
    ),
  });
  const url = cloud.pageUrl("/essay");
  await openLibrary(tab, cloud);
  await tab.evaluate((pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, url);
  await expect
    .poll(async () => {
      const { items } = await library.items.list({});
      return items.find((row) => row.url === url)?.id;
    })
    .toBeDefined();
  const { items } = await library.items.list({});
  const id = items.find((row) => row.url === url)?.id ?? "";
  await expect.poll(async () => await settled(library, id)).not.toBeNull();
  const read = await library.items.read({ id });
  expect(read.fields).toMatchObject({
    author: "Ada Example",
    description: "Why a folder of text files outlasts every app.",
    fetchError: null,
    fetchState: "filled",
    kind: "link",
    site: "The Example Journal",
    title: "Keeping notes in plain files",
    url,
  });
  expect(read.view.markdown).toContain("A folder of text files outlasts every app that reads it.");
  expect(read.view.markdown).toContain("## What lasts");
  expect(read.view.markdown).not.toContain("Written on a quiet afternoon.");
  expect(await download(cloud, account, await coverShaOf(library, id))).toEqual(Buffer.from(cover));
  expect(cloud.fetched).toEqual(expect.arrayContaining(["/essay", "/cover.png"]));

  const again = await library.items.saveLink({ url: `${url}?utm_source=feed` });
  expect([again.created, again.item.id]).toEqual([false, id]);
});

test("a Raindrop export imported from Settings files its links, fills them and adds nothing twice", async ({
  account,
  cloud,
  library,
  page: tab,
}) => {
  const [liveCover, deadCover] = [coverOf(400, 300), coverOf(300, 400)];
  cloud.pages.set("/covers/live.png", { body: liveCover, type: "image/png" });
  cloud.pages.set("/covers/dead.png", { body: deadCover, type: "image/png" });
  cloud.pages.set("/essays/gone", { status: 404 });
  cloud.pages.set("/essays/file-over-app", {
    body: page(
      "File over app",
      '<meta property="og:site_name" content="Steph Ango">',
      "<p>Files last. Apps do not, which is the whole case for files you control.</p><h2>Why files</h2><p>Apps are ephemeral. The files they write outlast them.</p><p>A format any program can open is a format nobody can take away.</p>",
    ),
  });
  // as Raindrop's export writes it
  const csv = `id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
1,File over app,For Tuesday.,,${cloud.pageUrl("/essays/file-over-app?utm_source=raindrop")},Reading,files,2023-07-01T09:12:30.000Z,${cloud.pageUrl("/covers/live.png")},"Highlight: Files last.
Note: The point.

Highlight: Apps are ephemeral.",false
2,A page that is gone,,,${cloud.pageUrl("/essays/gone")},Reading / Old,,2023-07-02T09:12:30.000Z,${cloud.pageUrl("/covers/dead.png")},Highlight: Words the page no longer holds.,false
`;
  const importCsv = async () => {
    await tab.getByLabel("The file to import").setInputFiles({
      buffer: Buffer.from(csv),
      mimeType: "text/csv",
      name: "raindrop.csv",
    });
  };
  await openLibrary(tab, cloud);
  await tab.keyboard.press("ControlOrMeta+,");
  await importCsv();
  await expect(tab.getByText("Added 2.")).toBeVisible();

  const { folders } = await library.organize.outline();
  const pathOf = (folderId: string | null): string => {
    const folder = folders.find((each) => each.id === folderId);
    return folder === undefined ? "" : `${pathOf(folder.parentId)}${folder.name}/`;
  };
  const { items } = await library.items.list({ kind: "link" });
  expect(items.map((item) => `${pathOf(item.folderId)}${item.title}`).toSorted()).toEqual([
    "Reading/File over app",
    "Reading/Old/A page that is gone",
  ]);
  const [live, dead] = ["File over app", "A page that is gone"].map(
    (title) => items.find((item) => item.title === title)?.id ?? "",
  );
  await expect.poll(async () => await settled(library, live ?? "")).not.toBeNull();
  const liveRead = await library.items.read({ id: live ?? "" });
  expect(liveRead.fields).toMatchObject({
    fetchError: null,
    fetchState: "filled",
    site: "Steph Ango",
    tags: ["files"],
  });
  // the export's note and its quoted highlights, above the article
  expect(liveRead.view.markdown).toMatch(
    /For Tuesday\.\n\n> Files last\.\n\nThe point\.\n\n> Apps are ephemeral\.[\s\S]*A format any program can open/u,
  );
  // the page names no picture, so the row's cover is the item's
  expect(await download(cloud, account, await coverShaOf(library, live ?? ""))).toEqual(
    Buffer.from(liveCover),
  );

  await expect.poll(async () => await settled(library, dead ?? "")).not.toBeNull();
  const deadRead = await library.items.read({ id: dead ?? "" });
  expect(deadRead.fields).toMatchObject({
    fetchError: "The site answered 404 (not found).",
    fetchState: "failed",
  });
  expect(deadRead.view.markdown).toContain("> Words the page no longer holds.");
  // no cover is fetched for a page the fill could not read
  expect(cloud.fetched).toContain("/essays/gone");
  expect(cloud.fetched).not.toContain("/covers/dead.png");

  await importCsv();
  await expect(tab.getByText("Added 0, 2 already in the library.")).toBeVisible();
  await expect(library.items.list({ kind: "link" })).resolves.toMatchObject({
    items: { length: 2 },
  });
});
