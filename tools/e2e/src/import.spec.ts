import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { V1Client } from "@repo/contract/v1";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { openLibrary, test } from "./fixtures";

const encoder = new TextEncoder();

const zipOf = async (entries: Readonly<Record<string, string>>): Promise<Buffer> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, text] of Object.entries(entries)) {
    await writer.add(path, new Uint8ArrayReader(encoder.encode(text)));
  }
  return Buffer.from(await writer.close());
};

// Settings › Import, the file chosen through its own button
const importFile = async (
  page: Page,
  button: string,
  file: { readonly name: string; readonly mimeType: string; readonly buffer: Buffer },
): Promise<void> => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: button }).click(),
  ]);
  await chooser.setFiles(file);
};

const titlesIn = async (library: V1Client["library"]): Promise<string[]> => {
  const { items } = await library.items.list({});
  return items.map((item) => item.title).toSorted();
};

test("Settings › Import reads a zip of notes and a Raindrop export on the device, and choosing the zip again lands nothing twice", async ({
  cloud,
  library,
  page,
  web,
}) => {
  const vault = await zipOf({
    ".obsidian/app.json": "{}",
    "Beta.md": "Beta's own words.\n",
    "Notes/Alpha.md": "---\ntags: [project]\n---\n# Alpha\n\nSee [[Beta]].\n",
  });
  await openLibrary(page, cloud);
  await page.keyboard.press("ControlOrMeta+,");
  const said = page.locator("[data-import-state]");

  await importFile(page, "Import a zip of notes…", {
    buffer: vault,
    mimeType: "application/zip",
    name: "Vault.zip",
  });
  await expect(said).toHaveText("Added 2.");
  expect(await titlesIn(library)).toStrictEqual(["Alpha", "Beta"]);

  await importFile(page, "Import a zip of notes…", {
    buffer: vault,
    mimeType: "application/zip",
    name: "Vault.zip",
  });
  await expect(said).toHaveText("Added 0, 2 already in the library.");
  expect(await titlesIn(library)).toStrictEqual(["Alpha", "Beta"]);

  for (const path of ["/one", "/two"]) {
    web.pages.set(path, { status: 404 });
  }
  const csv = [
    "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite",
    `1,First bookmark,,,${web.pageUrl("/one")},Reading,,,,,`,
    `2,Second bookmark,,,${web.pageUrl("/two")},,"a tag",,,,`,
  ].join("\n");
  await importFile(page, "Import from Raindrop…", {
    buffer: Buffer.from(csv),
    mimeType: "text/csv",
    name: "export.csv",
  });
  await expect(said).toHaveText("Added 2.");
  const { items } = await library.items.list({});
  expect(
    items
      .filter((item) => item.url !== null)
      .map((item) => item.title)
      .toSorted(),
  ).toStrictEqual(["First bookmark", "Second bookmark"]);
});
