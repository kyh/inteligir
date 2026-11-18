import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { deferred } from "@repo/contract/deferred";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import { EDITOR, markdownOf, openLibrary, test, typeAfter } from "./app.fixture";

const SAVE_BODY = `**${V1_RPC_PATH}/library/items/saveBody`;
const CONFLICT = "This note changed somewhere else while you were typing";

const SELECTION_READ_MS = 300;

const caretAfter = async (page: Page, line: string) => {
  const drawn = page.locator(EDITOR).getByText(line, { exact: true });
  const box = await drawn.boundingBox();

  if (box === null) {
    throw new Error(`"${line}" is not drawn`);
  }

  await drawn.click({ position: { x: box.width - 1, y: box.height / 2 } });
  await page.waitForTimeout(SELECTION_READ_MS);
};

const pressFrom = async (page: Page, focus: Locator, key: string) => {
  await focus.focus();
  await page.keyboard.press(key);
};

test("what one tab types shows in another once that one comes to the front", async ({
  cloud,
  library,
  page,
}) => {
  const line = "A line both tabs hold.";
  const { item } = await library.items.createNote({ markdown: `${line}\n`, title: "Plans" });
  const other = await page.context().newPage();
  await openLibrary(page, cloud, `?item=${item.id}`);
  await openLibrary(other, cloud, `?item=${item.id}`);
  await expect(other.locator(EDITOR)).toContainText(line);

  await page.bringToFront();
  await typeAfter(page, line, " Typed in the first tab.");
  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toContain("Typed in the first tab.");
  await other.bringToFront();
  await other.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });

  await expect(other.locator(EDITOR)).toContainText(`${line} Typed in the first tab.`, {
    timeout: 10_000,
  });
});

test("a save another tab's save made stale is merged, keeping both tabs' typing", async ({
  cloud,
  library,
  page,
}) => {
  const [one, two] = ["The first line.", "The second line."];

  const { item } = await library.items.createNote({
    markdown: `${one}\n\n${two}\n`,
    title: "Plans",
  });

  const other = await page.context().newPage();
  const firstLanded = deferred();
  await other.route(SAVE_BODY, async (route) => {
    await firstLanded.promise;
    await route.continue();
  });
  await openLibrary(page, cloud, `?item=${item.id}`);
  await openLibrary(other, cloud, `?item=${item.id}`);
  await expect(other.locator(EDITOR)).toContainText(two);

  await typeAfter(other, two, " Typed in the second tab.");
  await page.bringToFront();
  await typeAfter(page, one, " Typed in the first tab.");
  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toContain("Typed in the first tab.");
  firstLanded.resolve();

  const both = new RegExp(
    `${one} Typed in the first tab\\.[\\s\\S]*${two} Typed in the second tab\\.`,
    "u",
  );

  await expect.poll(async () => await markdownOf(library, item.id)).toMatch(both);
  await expect(other.locator(EDITOR)).toContainText(`${one} Typed in the first tab.`);
  await expect(other.getByText(CONFLICT)).toHaveCount(0);
});

test("the agent's edit holds the open note, then shows it beside what was typed", async ({
  cloud,
  library,
  page,
}) => {
  const lines = ["Line one.", "Line two.", "Line three.", "Line four.", "Line five."];

  const { item } = await library.items.createNote({
    markdown: lines.map((line) => `${line}\n`).join("\n"),
    title: "Plans",
  });

  await openLibrary(page, cloud, `?item=${item.id}`);
  await page.getByRole("button", { name: "Info and the agent" }).click();
  await page.getByRole("tab", { name: "Agent" }).click();
  const edit = { edits: [{ newText: "The agent's own line.", oldText: "Line two." }], id: item.id };
  const composer = page.getByLabel("Message the agent");
  await composer.fill(`Rewrite it.\ncall edit_item ${JSON.stringify(edit)}`);
  await typeAfter(page, "Line five.", " Typed while the agent wrote.");
  await composer.press("Enter");

  await expect(page.locator("[data-thread] [data-turn-ended]")).toBeVisible();
  await expect(page.locator(EDITOR)).toContainText("The agent's own line.");
  await expect(page.locator(EDITOR)).toContainText("Line five. Typed while the agent wrote.");
  await expect(page.getByText(CONFLICT)).toHaveCount(0);
  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toMatch(/The agent's own line\.[\s\S]*Line five\. Typed while the agent wrote\./u);
});

test("every key typed while the agent edits the open note is saved beside its edit", async ({
  cloud,
  library,
  page,
}) => {
  const lines = ["Line one.", "Line two.", "Line three.", "Line four.", "Line five."];

  const { item } = await library.items.createNote({
    markdown: lines.map((line) => `${line}\n`).join("\n"),
    title: "Plans",
  });

  await openLibrary(page, cloud, `?item=${item.id}`);
  await page.getByRole("button", { name: "Info and the agent" }).click();
  await page.getByRole("tab", { name: "Agent" }).click();
  const edit = { edits: [{ newText: "The agent's own line.", oldText: "Line two." }], id: item.id };
  const composer = page.getByLabel("Message the agent");
  await composer.fill(`Rewrite it.\ncall edit_item ${JSON.stringify(edit)}`);
  await composer.press("Enter");
  const burst = " Typed key by key while the agent wrote, every one kept.";
  await typeAfter(page, "Line five.", burst, { delay: 50 });

  await expect(page.locator("[data-thread] [data-turn-ended]")).toBeVisible();
  await expect(page.locator(EDITOR)).toContainText("The agent's own line.");
  await expect(page.locator(EDITOR)).toContainText(`Line five.${burst}`);
  await expect(page.getByText(CONFLICT)).toHaveCount(0);
  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toMatch(
      /The agent's own line\.[\s\S]*Line five\. Typed key by key while the agent wrote, every one kept\./u,
    );
});

test("a note with no connection takes no key: a mark's chord, Tab, a list's chord and Enter leave it as the library holds it", async ({
  cloud,
  context,
  library,
  page,
}) => {
  const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  const { item } = await library.items.createNote({
    markdown: [
      "Bold words sit beside [a link](https://example.com/page).",
      "- A first item\n- An item to indent",
      "A line to list",
      video.replace("://", "\\://"),
    ]
      .map((block) => `${block}\n`)
      .join("\n"),
    title: "Plans",
  });

  const { seq } = await library.items.row({ id: item.id });
  const held = await markdownOf(library, item.id);
  await openLibrary(page, cloud, `?item=${item.id}`);
  const editor = page.locator(EDITOR);
  await expect(editor).toContainText(video);

  await context.setOffline(true);
  await expect(page.getByText(NEEDS_CONNECTION).first()).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  const link = editor.getByRole("link", { name: "a link" });
  await editor.getByText("Bold words sit beside", { exact: true }).dblclick({
    position: { x: 2, y: 2 },
  });
  await page.waitForTimeout(SELECTION_READ_MS);
  await pressFrom(page, link, "ControlOrMeta+b");
  await caretAfter(page, "An item to indent");
  await pressFrom(page, link, "Tab");
  await caretAfter(page, "A line to list");
  await pressFrom(page, link, "ControlOrMeta+l");
  await caretAfter(page, video);
  await pressFrom(page, link, "Enter");
  await expect(editor.locator("strong")).toHaveCount(0);

  await context.setOffline(false);
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.waitForTimeout(2500);
  await expect(library.items.row({ id: item.id })).resolves.toMatchObject({ seq });
  expect(await markdownOf(library, item.id)).toBe(held);
});
