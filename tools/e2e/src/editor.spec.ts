import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EDITOR, markdownOf, openLibrary, test, typeAfter } from "./fixtures";

const CONSTRUCTS = `# Constructs

Prose with **bold** and \`inline code\`.

> [!WARNING]
> Mind the gap.

> An ordinary quote, which is not a callout.

- [ ] an open task
- [x] a done task

\`\`\`ts
const x = 1;
\`\`\`

| Name | Right |
| ---- | ----- |
| a    | 1     |

\`\`\`mermaid
graph TD;
A[Draft]-->B[Review];
\`\`\`
`;

const rows = (page: Page) => page.getByRole("option");

test("every construct draws under the page's policy, opening writes nothing, and an edit keeps them all", async ({
  cloud,
  library,
  page,
}) => {
  const { item } = await library.items.createNote({ markdown: CONSTRUCTS, title: "Constructs" });
  const { seq } = await library.items.row({ id: item.id });
  await openLibrary(page, cloud, `?item=${item.id}`);
  const editor = page.locator(EDITOR);
  await expect(editor.locator("table")).toBeVisible();
  await expect(editor.locator("strong")).toHaveText("bold");
  // the callout and the ordinary quote
  await expect(editor.locator("blockquote")).toHaveCount(2);
  await expect(editor.getByRole("checkbox")).toHaveCount(2);
  await expect(editor.locator("pre").first()).toBeVisible();

  // Pele's own class on its drawing; the flip and both reads run in one task, so a fill that
  // changes is the stylesheet's doing alone, with no redraw
  const diagram = editor.locator("svg.pele");
  await expect(diagram).toContainText("Draft");
  const flip = await diagram.evaluate((svg) => {
    const node = svg.querySelector("rect");
    const root = document.documentElement;
    const before = node === null ? "" : getComputedStyle(node).fill;
    root.classList.toggle("dark");
    const after = node === null ? "" : getComputedStyle(node).fill;
    root.classList.toggle("dark");
    return { after, before, labels: [...svg.querySelectorAll("text")].map((t) => t.textContent) };
  });
  expect(flip.labels).toEqual(expect.arrayContaining(["Draft", "Review"]));
  expect(flip.before).not.toBe("");
  expect(flip.after).not.toBe(flip.before);

  // past the note's debounced save, which an open that wrote would have pushed
  await page.waitForTimeout(2500);
  await expect(library.items.row({ id: item.id })).resolves.toMatchObject({ seq });

  await typeAfter(page, "Constructs", " Edited.");
  await expect.poll(async () => await markdownOf(library, item.id)).toContain("Edited.");
  const after = await markdownOf(library, item.id);
  for (const marker of [
    "**bold**",
    "`inline code`",
    "> [!WARNING]",
    "- [ ]",
    "```ts",
    "| Name |",
    "```mermaid",
  ]) {
    expect(after).toContain(marker);
  }
});

test("the slash menu inserts a heading, its query typed before its field has focus included", async ({
  cloud,
  library,
  page,
}) => {
  const { item } = await library.items.createNote({
    markdown: "# Plans\n\nFirst paragraph.\n",
    title: "Plans",
  });
  await openLibrary(page, cloud, `?item=${item.id}`);
  const editor = page.locator(EDITOR);

  // an Enter mid-paragraph would split it, and the block transform eat the tail
  await typeAfter(page, "First paragraph.", "");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(rows(page).first()).toBeVisible();
  // slate-react answers a selectionchange on a 100ms throttle, and a person reads the menu first
  await page.waitForTimeout(500);
  await page.keyboard.type("h2");
  await expect(rows(page)).toHaveText([/^Heading 2/u]);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Slash heading");
  await expect(rows(page)).toHaveCount(0);
  await expect(editor.getByRole("heading", { level: 2, name: "Slash heading" })).toBeVisible();
  await expect.poll(async () => await markdownOf(library, item.id)).toContain("## Slash heading");
  const saved = await markdownOf(library, item.id);
  expect(saved).not.toContain("/h2");
  expect(saved).toContain("First paragraph.");

  // every key in one task, so the menu's field mounts only after they all reached the editor
  await typeAfter(page, "Slash heading", "");
  await page.keyboard.press("Enter");
  await editor.evaluate((target) => {
    for (const data of "/h3") {
      target.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data,
          inputType: "insertText",
        }),
      );
    }
  });
  await expect(rows(page)).toHaveText([/^Heading 3/u]);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Raced heading");
  await expect.poll(async () => await markdownOf(library, item.id)).toContain("### Raced heading");
  expect(await markdownOf(library, item.id)).not.toContain("/h3");
});
