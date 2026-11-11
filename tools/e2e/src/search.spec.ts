import { expect } from "@playwright/test";
import { EDITOR, markdownOf, openLibrary, test, typeAfter } from "./fixtures";

const LINE = "Another zebrafish here, and a zebrafish there.";

test("the palette finds exactly the items holding the words, a word typed a moment ago included", async ({
  cloud,
  library,
  page,
}) => {
  const one = await library.items.createNote({
    markdown: "# One\n\nThe zebrafish swims.\n",
    title: "One",
  });
  const two = await library.items.createNote({ markdown: `# Two\n\n${LINE}\n`, title: "Two" });
  await library.items.createNote({
    markdown: "# Three\n\nNothing to find in here.\n",
    title: "Three",
  });
  const hits = page.locator("[data-search-hit]");
  const field = page.getByLabel("Search the library");
  const search = async (words: string) => {
    await page.keyboard.press("ControlOrMeta+P");
    await field.fill(words);
  };

  await openLibrary(page, cloud);
  await search("zebrafish");
  await expect(hits).toHaveCount(2);
  for (const { item } of [one, two]) {
    await expect(page.locator(`[data-search-hit="${item.id}"]`)).toBeVisible();
  }
  await page.locator(`[data-search-hit="${two.item.id}"]`).click();
  await expect(page.getByRole("textbox", { name: "Find" })).toHaveValue("zebrafish");
  await expect(page.locator(EDITOR)).toContainText("Another zebrafish");

  // the chord over the editor types nothing into it: the next keys typed land alone
  const before = await markdownOf(library, two.item.id);
  await page.locator(EDITOR).getByText(LINE, { exact: true }).click();
  await search("");
  await page.keyboard.press("Escape");
  await expect(field).toBeHidden();
  await typeAfter(page, LINE, " Quillfeather");
  await expect
    .poll(async () => await markdownOf(library, two.item.id))
    .toBe(before.replace(LINE, `${LINE} Quillfeather`));
  await search("Quillfeather");
  await expect(hits).toHaveCount(1);
  await expect(hits).toHaveAttribute("data-search-hit", two.item.id);
});
