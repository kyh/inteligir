import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import { download, libraryOf, newId, openLibrary, signUp, test, upload } from "./fixtures";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const MINUTES = Buffer.from("Minutes of the launch meeting.\n");

const EXPORT = "Export the library…";

// Settings › Export, in the tab `page` holds; what it said once it wrote the zip
const exportFromSettings = async (page: Page, said: string): Promise<void> => {
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByRole("button", { name: EXPORT }).click();
  await expect(page.locator("[data-export-state]")).toHaveText(said);
};

// each folder's names from the top, by its id
const folderPathsOf = async (library: V1Client["library"]) => {
  const { folders } = await library.listing.scopes();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return (id: string | null): string[] => {
    const names: string[] = [];
    for (
      let folder = id === null ? undefined : byId.get(id);
      folder !== undefined;
      folder = folder.parentId === null ? undefined : byId.get(folder.parentId)
    ) {
      names.unshift(folder.name);
    }
    return names;
  };
};

// every live item as the library holds it, its folder by its names, since an import makes folders
// of its own, and its pin as whether it is pinned, since a file says only that
const libraryAsHeld = async (library: V1Client["library"]) => {
  const folderPath = await folderPathsOf(library);
  const { items } = await library.listing.page({ limit: 100, scope: { kind: "all" } });
  const held = await Promise.all(
    items.map(async ({ id }) => {
      const [whole, read] = await Promise.all([
        library.items.get({ id }),
        library.items.read({ id }),
      ]);
      return {
        fields: {
          ...whole.fields,
          folderId: folderPath(whole.fields.folderId),
          pinnedAt: whole.fields.pinnedAt !== null,
        },
        id,
        links: read.links,
        markdown: read.view.markdown,
      };
    }),
  );
  return held.toSorted((one, other) => one.id.localeCompare(other.id));
};

test("Settings › Export writes the library as a zip Import reads back into a fresh account as the same items", async ({
  account,
  cloud,
  context,
  library,
  page,
  web,
}) => {
  const plan = await library.items.createNote({
    folder: { path: "Projects/Q4 plans" },
    markdown: "# Launch\n\nShip it.\n\n- [ ] tell everyone\n",
    tags: ["work", "launch"],
    title: "Launch plan",
  });
  await library.write({
    itemId: plan.item.id,
    ops: [
      { key: "status", op: "property", value: "draft" },
      { key: "priority", op: "property", value: 2 },
      { key: "done", op: "property", value: false },
      { key: "reviewers", op: "property", value: ["Grace", "Linus"] },
    ],
  });
  await library.items.organize({ ids: [plan.item.id], pinned: true });
  await library.items.createNote({
    folder: { path: "Projects" },
    markdown: `Read the [Launch plan](mention:${plan.item.id}) first.\n`,
    title: "Ideas",
  });
  const coverSha = await upload(cloud, account, new Uint8Array(PIXEL), "image/png");
  await library.items.save({
    article: [{ children: [{ text: "Notes are for thinking." }], id: newId(), type: "p" }],
    coverSha,
    facts: {
      author: "Ada Example",
      description: "How notes become writing.",
      lang: "en",
      published: "2026-10-01",
      site: "The Example Journal",
    },
    folderId: null,
    id: newId(),
    note: "My take: keep it short.",
    savedAt: Date.now(),
    tags: ["reading"],
    title: "How to take smart notes",
    url: web.pageUrl("/smart-notes"),
  });
  const pdfSha = await upload(cloud, account, new Uint8Array(PDF), "application/pdf");
  await library.items.createFile({
    folderId: null,
    id: newId(),
    name: "Lecture.pdf",
    savedAt: Date.now(),
    sha: pdfSha,
    tags: [],
  });
  const minutesSha = await upload(cloud, account, new Uint8Array(MINUTES), "text/plain");
  await library.items.create({
    blocks: [
      { block: { children: [{ text: "The minutes:" }], id: newId(), type: "p" }, section: "note" },
      {
        block: {
          children: [{ text: "" }],
          id: newId(),
          name: "minutes.txt",
          sha: minutesSha,
          type: "file",
        },
        section: "note",
      },
    ],
    folderId: null,
    id: newId(),
    savedAt: Date.now(),
    tags: [],
    title: "Launch meeting",
  });

  // a window with no save picker, as Safari's, Firefox's and the Mac app's are: the zip downloads
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
  });
  await openLibrary(page, cloud);
  const downloaded = page.waitForEvent("download");
  await exportFromSettings(page, "Wrote 5 items.");
  const zip = await downloaded;
  expect(zip.suggestedFilename()).toMatch(/^Inteligir library \d{4}-\d{2}-\d{2}\.zip$/u);
  const bytes = await readFile(await zip.path());

  const fresh = await signUp(cloud);
  await context.clearCookies();
  await context.addCookies(fresh.cookies.map((cookie) => ({ ...cookie, url: cloud.origin })));
  await openLibrary(page, cloud);
  await page.keyboard.press("ControlOrMeta+,");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import a zip of notes…" }).click(),
  ]);
  await chooser.setFiles({
    buffer: bytes,
    mimeType: "application/zip",
    name: zip.suggestedFilename(),
  });
  await expect(page.locator("[data-import-state]")).toHaveText("Added 5.");

  const freshLibrary = libraryOf(cloud, fresh);
  expect(await libraryAsHeld(freshLibrary)).toStrictEqual(await libraryAsHeld(library));
  for (const [sha, held] of [
    [coverSha, PIXEL],
    [pdfSha, PDF],
    [minutesSha, MINUTES],
  ] as const) {
    expect(await download(cloud, fresh, sha)).toStrictEqual(held);
  }
});

test("Settings › Export streams the zip into the file the save picker names", async ({
  browserName,
  cloud,
  library,
  page,
}) => {
  test.skip(browserName !== "chromium", "only Chromium has a save picker");
  await library.items.createNote({ markdown: "Words to keep.\n", title: "Only note" });
  // the picker answers a file of the page's own storage, which a person's choice would be on disk
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory();
        return await root.getFileHandle("export.zip", { create: true });
      },
    });
  });
  await openLibrary(page, cloud);
  await exportFromSettings(page, "Wrote 1 item.");
  const written = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("export.zip");
    const file = await handle.getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  });
  const entries = await new ZipReader(
    new BlobReader(new Blob([Uint8Array.from(written)])),
  ).getEntries();
  expect(entries.map((entry) => entry.filename)).toStrictEqual(["Only note.md"]);
  const [note] = entries;
  expect(note?.directory === false ? await note.getData(new TextWriter()) : "").toContain(
    "Words to keep.",
  );
});
