import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EDITOR, newId, openLibrary, test, upload } from "./fixtures";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
// TEST-NET-1, which the fill refuses before any fetch
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

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Archive");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Folders" })).toContainText("Archive");
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

  // a paste and a drop as the browser hands them over, where no field claims them
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
