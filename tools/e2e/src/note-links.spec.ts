import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EDITOR, markdownOf, openLibrary, test, typeAfter } from "./fixtures";

const PASSAGE = "Herons wait before they strike.";
const STAYS = "This paragraph stays where it is.";
const PARAGRAPH = "The heron at the weir, this morning.";
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const rows = (page: Page) => page.getByRole("option");

// the note's picture as drawn: from bytes the tab holds, once decoded
const drawnPicture = async (page: Page) =>
  await page.locator(`${EDITOR} img`).evaluate((img: HTMLImageElement) => ({
    blob: img.src.startsWith("blob:"),
    width: img.complete ? img.naturalWidth : 0,
  }));

test("a bound formula reads its pill, Extract makes a linked note, and [[ links or creates", async ({
  cloud,
  library,
  page,
}) => {
  const sizes = await library.items.createNote({
    markdown: ':formula[40]{meta="id=fb;name=base" source="40"}\n',
    title: "Sizes",
  });
  const formula = `:formula[0]{meta="id=fa;name=bigger" source="@(base#${sizes.item.id}#fb)+2"}`;
  const { item } = await library.items.createNote({
    folder: { path: "Birds" },
    markdown: `# Field notes\n\nDouble it: ${formula}\n\n${PASSAGE}\n\n${STAYS}\n`,
    title: "Field notes",
  });
  const { folders } = await library.organize.outline();
  const folderId = folders.find((folder) => folder.name === "Birds")?.id;
  const inFolder = async (title: string) => {
    const { items } = await library.items.list({ folderId, limit: 50 });
    return items.find((row) => row.title === title)?.id;
  };
  await openLibrary(page, cloud, `?item=${item.id}`);

  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toContain(':formula[42]{meta="id=fa;name=bigger"');

  await page.locator(EDITOR).getByText(PASSAGE, { exact: true }).selectText();
  await page.getByRole("button", { name: "Extract to new note" }).click();
  await expect.poll(async () => await inFolder(PASSAGE)).toBeDefined();
  const made = (await inFolder(PASSAGE)) ?? "";
  await expect.poll(async () => await markdownOf(library, made)).toContain(PASSAGE);
  await expect.poll(async () => await markdownOf(library, item.id)).toContain(`(mention:${made})`);
  const left = await markdownOf(library, item.id);
  expect(left).not.toContain(`\n${PASSAGE}\n`);
  expect(left).toContain(STAYS);

  await typeAfter(page, STAYS, " [[");
  await expect(rows(page).first()).toBeVisible();
  await page.keyboard.type("Siz");
  await expect(rows(page).first()).toHaveText("Sizes");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toContain(`${STAYS} [Sizes](mention:${sizes.item.id})`);

  await page.keyboard.type(" [[");
  await expect(rows(page).first()).toBeVisible();
  await page.keyboard.type("Wading birds");
  await expect(rows(page)).toHaveText(["Create Wading birds"]);
  await page.keyboard.press("Enter");
  await expect.poll(async () => await inFolder("Wading birds")).toBeDefined();
  const created = (await inFolder("Wading birds")) ?? "";
  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toContain(`[Wading birds](mention:${created})`);
  expect(await markdownOf(library, item.id)).not.toContain("\\[");
});

test("a picture pasted into a note is kept by its sha and drawn at once, after a reload and elsewhere", async ({
  cloud,
  library,
  page,
  secondContext,
}) => {
  const { item } = await library.items.createNote({
    markdown: `${PARAGRAPH}\n`,
    title: "Field notes",
  });
  await openLibrary(page, cloud, `?item=${item.id}`);
  // typed first, so the editor's own selection is at the end before the paste reads it
  await typeAfter(page, PARAGRAPH, " Look:");
  // a screenshot as the browser hands one over: a file, and no markup
  await page.locator(EDITOR).evaluate(
    (editor, bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(bytes)], "heron.png", { type: "image/png" }));
      editor.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
      );
    },
    [...PIXEL],
  );
  const drawn = { blob: true, width: 1 };
  await expect.poll(async () => await drawnPicture(page)).toEqual(drawn);

  // the cell takes no write naming a file it does not hold, so this says the bytes went up first
  const sha = createHash("sha256").update(PIXEL).digest("hex");
  await expect.poll(async () => await markdownOf(library, item.id)).toContain(`assets/${sha}`);
  expect(await markdownOf(library, item.id)).toContain(PARAGRAPH);

  await page.reload();
  await expect.poll(async () => await drawnPicture(page)).toEqual(drawn);
  const second = await secondContext.newPage();
  await openLibrary(second, cloud, `?item=${item.id}`);
  await expect.poll(async () => await drawnPicture(second)).toEqual(drawn);
});
