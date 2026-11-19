import { expect } from "@playwright/test";
import { openLibrary, test } from "./app.fixture";

test.use({ allowedErrors: /429 \(Too Many Requests\) \(\S+\/agent\/send\)/u });

test("the built-in agent writes a note, deletes two, takes a turn and then its conversation back, and keeps to the day", async ({
  cloud,
  library,
  page,
}) => {
  const noteTitled = async (title: string) => {
    const { item } = await library.items.createNote({ markdown: `${title}.`, title });

    return item.id;
  };

  const first = await noteTitled("Bin me");
  const second = await noteTitled("Bin me too");

  const deletedAt = async (id: string) => {
    const { fields } = await library.items.read({ id });

    return fields.deletedAt;
  };

  const card = (id: string) => page.locator(`[role="gridcell"][data-item-id="${id}"]`);
  await openLibrary(page, cloud);
  await expect(card(first)).toBeVisible();

  await page.keyboard.press("ControlOrMeta+K");
  const composer = page.getByLabel("Message the agent");
  await composer.fill('Make a note.\ncall create_note {"markdown":"Paris in spring."}\nlong 1500');
  await composer.press("Enter");
  await expect(page.getByText("Working…")).toBeVisible();
  await expect(page.getByText("Wrote a note")).toBeVisible();
  const undoTurn = page.getByRole("button", { name: "Undo this turn" });
  await expect(undoTurn).toHaveCount(1);
  await expect(page.getByText("Working…")).toHaveCount(0);
  const { hits } = await library.search({ query: "Paris" });
  const made = hits[0]?.id ?? "";
  await expect(card(made)).toBeVisible();

  await composer.fill(`call delete_items ${JSON.stringify({ ids: [first, second] })}`);
  await composer.press("Enter");
  await expect(page.locator("[data-turn-ended]")).toHaveCount(2);
  await expect(card(first)).toHaveCount(0);
  await expect(card(second)).toHaveCount(0);
  await expect(deletedAt(second)).resolves.toStrictEqual(expect.any(String));

  await expect(undoTurn).toHaveCount(2);
  await page
    .locator('[data-turn-ended="2"]')
    .getByRole("button", { name: "Undo this turn" })
    .click();
  await expect.poll(async () => await deletedAt(first)).toBeNull();
  await expect(deletedAt(second)).resolves.toBeNull();
  await expect(card(first)).toBeVisible();
  await expect(card(second)).toBeVisible();
  await expect(undoTurn).toHaveCount(1);
  await expect(deletedAt(made)).resolves.toBeNull();

  const undoConversation = page.getByRole("button", { name: "Undo this conversation" });
  await undoConversation.click();
  await expect.poll(async () => await deletedAt(made)).toStrictEqual(expect.any(String));
  await expect(card(made)).toHaveCount(0);
  await expect(undoTurn).toHaveCount(0);
  await expect(undoConversation).toHaveCount(0);

  await composer.fill("One more.");
  await composer.press("Enter");
  await expect(page.getByText("The agent has used today’s allowance")).toBeVisible();
});
