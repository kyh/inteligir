import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { V1_BLOBS_NAME_PARAM, V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import { EDITOR, newId, openLibrary, skipScriptedPaste, test, typeAfter, upload } from "./fixtures";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
// an address written as numbers, which the fill refuses before any fetch
const PASTED = "http://192.0.2.10/pasted";

const cardOf = (page: Page, title: string) =>
  page.getByRole("grid", { name: "Library" }).getByRole("gridcell", { name: title });
const scopeTitle = (page: Page) => page.getByRole("heading", { level: 1 });
const itemParam = (id: string | null) => (url: URL) => url.searchParams.get("item") === id;

test("the grid opens, narrows, previews, tags, deletes, files and follows the cell", async ({
  account,
  cloud,
  library,
  page,
}) => {
  const welcome = await library.items.createNote({
    markdown: "# Welcome\n\nStart here.\n",
    title: "Welcome",
  });
  const field = await library.items.createNote({
    folder: { path: "Reading" },
    markdown: "# Field notes\n\nNotes from the field.\n",
    tags: ["field"],
    title: "Field notes",
  });
  const sha = await upload(cloud, account, new Uint8Array(PIXEL), "image/png");
  const pier = await library.items.createFile({
    folderId: null,
    id: newId(),
    name: "pier.png",
    savedAt: Date.now(),
    sha,
    tags: [],
  });
  const fieldsOf = async (id: string) => {
    const { fields } = await library.items.read({ id });
    return fields;
  };

  await openLibrary(page, cloud);
  const grid = page.getByRole("grid", { name: "Library" });
  await expect(grid.getByRole("gridcell")).toHaveCount(3);
  await expect(page).toHaveURL(itemParam(null));

  await cardOf(page, "Welcome").dblclick();
  await expect(page.locator(EDITOR)).toBeVisible();
  await expect(page).toHaveURL(itemParam(welcome.item.id));
  await page.goBack();
  await expect(grid).toBeVisible();
  await expect(page).toHaveURL(itemParam(null));
  await page.goForward();
  await expect(page.locator(EDITOR)).toBeVisible();
  await expect(page).toHaveURL(itemParam(welcome.item.id));
  await page.getByRole("button", { name: "Back to the library" }).click();

  await page
    .getByRole("list", { name: "Folders" })
    .getByRole("button", { name: /^Reading/u })
    .click();
  await expect(scopeTitle(page)).toHaveText("Reading");
  await expect(grid.getByRole("gridcell")).toHaveText([/Field notes/u]);
  await page
    .getByRole("list", { name: "Tags" })
    .getByRole("button", { name: /^field/u })
    .click();
  await expect(scopeTitle(page)).toHaveText("#field");
  await expect(grid.getByRole("gridcell")).toHaveText([/Field notes/u]);
  await page.goBack();
  await expect(scopeTitle(page)).toHaveText("Reading");

  await page
    .getByRole("list", { name: "Library" })
    .getByRole("button", { name: /^All items/u })
    .click();
  await expect(scopeTitle(page)).toHaveText("All items");
  const images = page.getByLabel("Kind").getByRole("button", { name: /^Images/u });
  await images.click();
  await expect(grid.getByRole("gridcell")).toHaveText([/pier/u]);
  await images.click();
  await expect(grid.getByRole("gridcell")).toHaveCount(3);

  await cardOf(page, "Welcome").click();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog")).toContainText("Start here.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.keyboard.press("]");
  await page.getByRole("tabpanel", { name: "Info" }).getByRole("button", { name: "Tag…" }).click();
  await page.getByLabel("Tag to add").fill("e2e");
  await page.keyboard.press("Enter");
  await expect.poll(async () => await fieldsOf(welcome.item.id)).toMatchObject({ tags: ["e2e"] });
  await page.keyboard.press("]");

  await cardOf(page, "pier").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect
    .poll(async () => await fieldsOf(pier.item.id))
    .toMatchObject({ deletedAt: expect.any(String) });
  await page
    .getByRole("region", { name: /Notifications/u })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect.poll(async () => await fieldsOf(pier.item.id)).toMatchObject({ deletedAt: null });
  await expect(cardOf(page, "pier")).toBeVisible();

  // ⌘A over a scope the grid read whole names its items, so Delete's Undo brings each back
  await cardOf(page, "pier").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect
    .poll(async () => await library.listing.scopes())
    .toMatchObject({ deleted: 3, total: 0 });
  await page
    .getByRole("region", { name: /Notifications/u })
    .getByRole("listitem")
    .filter({ hasText: "Moved 3 items to Deleted." })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect
    .poll(async () => await library.listing.scopes())
    .toMatchObject({ deleted: 0, total: 3 });
  await expect(cardOf(page, "pier")).toBeVisible();

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Archive");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Folders" })).toContainText("Archive");
  // a folder's menu button stays drawn under its own open menu, wherever the pointer went
  const more = page.getByRole("button", { name: "More for Archive" });
  await more.click();
  await page.getByRole("menuitem", { name: "Rename…" }).hover();
  await expect(more).toHaveAttribute("data-popup-open", "");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  const { folders } = await library.organize.outline();
  const archive = folders.find((folder) => folder.name === "Archive");
  await cardOf(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
  await expect
    .poll(async () => await fieldsOf(welcome.item.id))
    .toMatchObject({ folderId: archive?.id });
  await expect(page.getByRole("dialog")).toBeHidden();

  await cardOf(page, "Field notes").dblclick();
  await expect(page.locator(EDITOR)).toBeVisible();
  await library.items.organize({ ids: [field.item.id], title: "Field journal" });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Field journal");
  await expect(page).toHaveURL(itemParam(field.item.id));
  await page.getByRole("button", { name: "Back to the library" }).click();

  // Empty Deleted is one ask, which the cell lands by itself while the grid follows it
  await cardOf(page, "pier").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("list", { name: "Deleted" })
    .getByRole("button", { name: "Deleted" })
    .click();
  await expect(grid.getByRole("gridcell")).toHaveText([/pier/u]);
  await page.getByRole("button", { name: "Empty Deleted…" }).click();
  await page.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByText("Nothing deleted")).toBeVisible();
  await expect.poll(async () => await library.listing.scopes()).toMatchObject({ deleted: 0 });
});

// the tab learns of it by asking what moved, on its beat
// a paste and a drop as the browser hands them over, where no field claims them: the picture is
// one the library holds, so only the PDF's bytes go to the store
test("a paste and a drop on the grid land a link, a picture and a PDF", async ({
  account,
  browserName,
  cloud,
  library,
  page,
}) => {
  skipScriptedPaste(browserName);
  const sha = await upload(cloud, account, new Uint8Array(PIXEL), "image/png");
  await library.items.createFile({
    folderId: null,
    id: newId(),
    name: "pier.png",
    savedAt: Date.now(),
    sha,
    tags: [],
  });
  await openLibrary(page, cloud);
  const grid = page.getByRole("grid", { name: "Library" });
  await expect(grid.getByRole("gridcell")).toHaveCount(1);

  await grid.evaluate(
    (target, { pasted, pixel }) => {
      const text = new DataTransfer();
      text.setData("text/plain", pasted);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: text }),
      );
      const files = new DataTransfer();
      files.items.add(new File([Uint8Array.from(pixel)], "dropped.png", { type: "image/png" }));
      files.items.add(new File(["%PDF-1.4\n%%EOF\n"], "Lecture.pdf", { type: "application/pdf" }));
      for (const type of ["dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: files }),
        );
      }
    },
    { pasted: PASTED, pixel: [...PIXEL] },
  );
  await expect
    .poll(async () => {
      const { items } = await library.items.list({});
      return items
        .map(({ kind, title, url }) => ({ kind, title, url }))
        .toSorted((a, b) => a.title.localeCompare(b.title));
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: PASTED }),
        expect.objectContaining({ kind: "image", title: expect.stringContaining("dropped") }),
        expect.objectContaining({ kind: "pdf", title: expect.stringContaining("Lecture") }),
      ]),
    );
});

test("a write from another device appears", async ({ cloud, library, page }) => {
  await openLibrary(page, cloud);
  await expect(page.getByRole("grid", { name: "Library" }).getByRole("gridcell")).toHaveCount(0);

  await library.items.create({
    blocks: [],
    folderId: null,
    id: newId(),
    opId: newId(),
    savedAt: Date.now(),
    tags: [],
    title: "Written elsewhere",
  });
  await expect(cardOf(page, "Written elsewhere")).toBeVisible({ timeout: 20_000 });
});

test.describe(() => {
  test.use({ allowedErrors: /net::ERR_FAILED \(\S+\/library\/items\/saveBody\)/u });

  // every save of the note is dropped on its way while the browser still says it is online, so what is
  // typed is typing no save carried
  test("Back and the tab's close ask before they lose typing no save carried", async ({
    cloud,
    library,
    page,
  }) => {
    const line = "A line the note holds.";
    const { item } = await library.items.createNote({
      markdown: `# Plans\n\n${line}\n`,
      title: "Plans",
    });
    await page.route(`**${V1_RPC_PATH}/library/items/saveBody`, async (route) => {
      await route.abort();
    });
    await openLibrary(page, cloud);
    await cardOf(page, "Plans").dblclick();
    await expect(page.locator(EDITOR)).toContainText(line);
    await typeAfter(page, line, " Typed with no save.");

    const ask = page.getByRole("alertdialog", { name: "Leave without saving?" });
    await page.goBack();
    await ask.getByRole("button", { name: "Stay" }).click();
    await expect(page).toHaveURL(itemParam(item.id));
    await expect(page.locator(EDITOR)).toContainText("Typed with no save.");

    const closing = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    const unload = await closing;
    expect(unload.type()).toBe("beforeunload");
    await unload.dismiss();

    await page.goBack();
    await ask.getByRole("button", { name: "Leave anyway" }).click();
    await expect(page.getByRole("grid", { name: "Library" })).toBeVisible();
    await expect(page).toHaveURL(itemParam(null));
  });
});

// Chromium frames the PDF viewer, so a page policy that refuses the frame is a console error the
// watch fails on, and the frame never appears; headless WebKit frames no viewer at all, and
// Firefox's frame tells Playwright no address. The viewer is titled by the name the file came
// with, which its download saves it as too
test("a PDF item draws in the browser's own viewer, under its own name", async ({
  account,
  browserName,
  cloud,
  library,
  page,
}) => {
  test.skip(browserName !== "chromium", "only Chromium frames its PDF viewer");
  const sha = await upload(cloud, account, PDF, "application/pdf");
  const name = "Lecture notes é.pdf";
  const lecture = await library.items.createFile({
    folderId: null,
    id: newId(),
    name,
    savedAt: Date.now(),
    sha,
    tags: [],
  });

  await openLibrary(page, cloud);
  await cardOf(page, "Lecture").dblclick();
  await expect(page).toHaveURL(itemParam(lecture.item.id));
  const asked = new URLSearchParams({ [V1_BLOBS_NAME_PARAM]: name });
  await expect
    .poll(() => page.frames().map((frame) => frame.url()))
    .toContain(`${cloud.origin}${V1_BLOBS_PATH}/${sha}?${asked.toString()}`);
  await expect
    .poll(
      async () =>
        await Promise.all(page.frames().map(async (frame) => await frame.title().catch(() => ""))),
    )
    .toContain(name);
});
