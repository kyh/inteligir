import { expect, test } from "@playwright/test";

// The pieces a static gate cannot see working together: the renderer booting
// over the fixture Bridge, the sidebar tree over the vault listing, the Plate
// editor rendering a note, and full-text search through the real knowledge
// engine (wasm sqlite FTS). Assertions lean on fixture-bridge.ts's
// SAMPLE_NOTES, which the legacy-corpus test already pins.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("boots the renderer and lists the fixture vault", async ({ page }) => {
  const tree = page.getByRole("tree", { name: "Notes" });
  await expect(tree.getByRole("treeitem", { name: /welcome/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /tasks/ })).toBeVisible();
});

test("opens a note from the sidebar and renders its content", async ({ page }) => {
  await page.getByRole("tree", { name: "Notes" }).getByRole("treeitem", { name: /tasks/ }).click();
  await expect(page.getByText("Review the replatform plan")).toBeVisible();
});

test("finds a note by content through the palette and opens it", async ({ page }) => {
  await page.getByRole("button", { name: "Quick actions" }).click();
  const input = page.getByPlaceholder(/Search notes/);
  await expect(input).toBeVisible();

  // "canonical" appears only in snippets.md's body, never in a filename, so a
  // hit proves the FTS index answered — not the name filter.
  await input.fill("canonical");
  await page
    .getByRole("option", { name: /Snippets/ })
    .first()
    .click();
  await expect(page.getByText("Bytes on disk stay canonical.")).toBeVisible();
});
