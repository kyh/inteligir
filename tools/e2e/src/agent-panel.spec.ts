import { expect } from "@playwright/test";
import { openLibrary, test } from "./fixtures";

// the browser logs the refused third send's answer
test.use({ allowedErrors: /429 \(Too Many Requests\) \(\S+\/agent\/send\)/u });

// the Worker's own allowance: two turns a day, so the third send meets it
test("the built-in agent writes, asks before deleting, undoes its conversation and keeps to the day", async ({
  cloud,
  library,
  page,
}) => {
  const bin = await library.items.createNote({ markdown: "Bin me.", title: "Bin me" });
  const keep = await library.items.createNote({ markdown: "Keep me.", title: "Keep me" });
  const fieldsOf = async (id: string) => {
    const { fields } = await library.items.read({ id });
    return fields;
  };
  const agentSets = async () => {
    const { changeSets } = await library.history.list({});
    return changeSets.filter((set) => set.actor === "agent");
  };
  const card = (id: string) => page.locator(`[role="gridcell"][data-item-id="${id}"]`);
  await openLibrary(page, cloud);
  await expect(card(bin.item.id)).toBeVisible();

  await page.keyboard.press("ControlOrMeta+K");
  const composer = page.getByLabel("Message the agent");
  // a reply the scripted Claude streams for a few seconds, so it is drawn as it is written
  await composer.fill('Make a note.\ncall create_note {"markdown":"Paris in spring."}\nlong 6000');
  await composer.press("Enter");
  const preview = page.locator("[data-agent-preview]");
  await expect(preview).toBeVisible();
  await expect(page.getByText("Wrote a note")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo this turn" })).toBeVisible();
  await expect(preview).toHaveCount(0);
  const [made] = await agentSets();
  await expect(card(made?.items[0]?.id ?? "")).toBeVisible();

  await composer.fill(
    [bin, keep].map(({ item }) => `call delete_items {"ids":["${item.id}"]}`).join("\n"),
  );
  await composer.press("Enter");
  const approval = page.locator("[data-approval]");
  await expect(approval).toBeVisible();
  await expect(fieldsOf(bin.item.id)).resolves.toMatchObject({ deletedAt: null });
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect
    .poll(async () => await fieldsOf(bin.item.id))
    .toMatchObject({ deletedAt: expect.any(String) });
  await expect(card(bin.item.id)).toHaveCount(0);
  await approval.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("[data-turn-ended]")).toHaveCount(2);
  await expect(fieldsOf(keep.item.id)).resolves.toMatchObject({ deletedAt: null });

  await expect.poll(async () => await agentSets()).toHaveLength(2);
  await page.getByRole("button", { name: "Undo this conversation" }).click();
  await expect.poll(async () => await fieldsOf(bin.item.id)).toMatchObject({ deletedAt: null });
  await expect
    .poll(async () => await fieldsOf(made?.items[0]?.id ?? ""))
    .toMatchObject({ deletedAt: expect.any(String) });
  await expect(card(bin.item.id)).toBeVisible();

  await composer.fill("One more.");
  await composer.press("Enter");
  await expect(page.getByText("The agent has used today’s allowance")).toBeVisible();
});
