import { expect } from "@playwright/test";
import { EDITOR, markdownOf, openLibrary, test, typeAfter } from "./fixtures";

const ONE = "Shared line one.";
const TWO = "Shared line two.";

test("one live body in two browsers: each sees the other's typing, a reload keeps it, and Deleted reads only", async ({
  cloud,
  library,
  page,
  secondContext,
}) => {
  const { item } = await library.items.createNote({
    markdown: `# Plans\n\n${ONE}\n\n${TWO}\n`,
    title: "Plans",
  });
  const other = await secondContext.newPage();
  await openLibrary(page, cloud, `?item=${item.id}`);
  await openLibrary(other, cloud, `?item=${item.id}`);

  await typeAfter(page, ONE, " From A.");
  await expect(other.locator(EDITOR)).toContainText(`${ONE} From A.`);
  await typeAfter(other, TWO, " From B.");
  await expect(page.locator(EDITOR)).toContainText(`${TWO} From B.`);
  await expect
    .poll(async () => await markdownOf(library, item.id))
    .toMatch(/Shared line one\. From A\.[\s\S]*Shared line two\. From B\./u);

  await typeAfter(other, `${TWO} From B.`, " Typed before the reload.");
  await other.reload();
  await expect(other.locator(EDITOR)).toContainText("Typed before the reload.");

  await library.items.delete({ ids: [item.id] });
  await openLibrary(other, cloud, `?item=${item.id}`);
  await expect(other.getByText("This item is in Deleted.")).toBeVisible();
  await expect(other.locator(EDITOR)).toContainText("Typed before the reload.");
  await expect(other.locator(EDITOR)).toHaveAttribute("contenteditable", "false");
});
