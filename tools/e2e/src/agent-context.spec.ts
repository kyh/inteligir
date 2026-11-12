import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { V1Client } from "@repo/contract/v1";
import { z } from "zod";
import { EDITOR, markdownOf, openLibrary, test, typeAfter } from "./fixtures";

// a day of more turns than a test sends
test.use({
  cloudOptions: { json: { AGENT_ALLOWANCE: { concurrentTurns: 2, dayTurns: 10 } } },
});

const UserMessageSchema = z.looseObject({
  text: z.string(),
  type: z.literal("user.message"),
  viewContext: z.json().optional(),
});

// the person's messages in the account's one conversation, in the order sent
const sentMessages = async (library: V1Client["library"]) => {
  const { threads } = await library.agent.list({});
  const [thread] = threads;
  if (thread === undefined) {
    return [];
  }
  const { events } = await library.agent.events({ limit: 500, threadId: thread.id });
  return events.flatMap((row) => {
    const parsed = UserMessageSchema.safeParse(row.event);
    return parsed.success ? [parsed.data] : [];
  });
};

const send = async (page: Page, text: string) => {
  const composer = page.getByLabel("Message the agent");
  await composer.fill(text);
  await composer.press("Enter");
};

test("a message names the screen it left from: the open item, the grid's selection, or none from Deleted", async ({
  cloud,
  library,
  page,
}) => {
  const plans = await library.items.createNote({ markdown: "A trip in spring.", title: "Plans" });
  const groceries = await library.items.createNote({ markdown: "Apples.", title: "Groceries" });
  const lastSent = async (count: number) => {
    await expect(page.locator("[data-thread] [data-turn-ended]")).toHaveCount(count);
    const messages = await sentMessages(library);
    expect(messages).toHaveLength(count);
    return messages.at(-1)?.viewContext;
  };
  await openLibrary(page, cloud, `?item=${plans.item.id}`);
  await page.keyboard.press("ControlOrMeta+K");
  await send(page, "Make this shorter.");
  expect(await lastSent(1)).toEqual({ itemId: plans.item.id, surface: "item" });

  await page.getByRole("button", { name: "Back to the library" }).click();
  await page
    .getByRole("grid", { name: "Library" })
    .getByRole("gridcell", { name: "Groceries" })
    .click();
  await send(page, "What is this one?");
  expect(await lastSent(2)).toEqual({
    itemIds: [groceries.item.id],
    scope: { kind: "all" },
    selected: 1,
    surface: "library",
  });

  await page
    .getByRole("list", { name: "Deleted" })
    .getByRole("button", { name: "Deleted" })
    .click();
  await send(page, "Anything here?");
  expect(await lastSent(3)).toBeUndefined();
});

test("Undo this turn takes the agent's line back and keeps what was typed, in the cell and both tabs", async ({
  cloud,
  library,
  page,
  secondContext,
}) => {
  const [one, two, three] = ["Shared line one.", "Shared line two.", "A line the agent rewrites."];
  const { item } = await library.items.createNote({
    markdown: `# Plans\n\n${one}\n\n${two}\n\n${three}\n`,
    title: "Plans",
  });
  const other = await secondContext.newPage();
  await openLibrary(page, cloud, `?item=${item.id}`);
  await openLibrary(other, cloud, `?item=${item.id}`);

  const edit = { edits: [{ newText: "The agent's own line.", oldText: three }], id: item.id };
  const sending = library.agent.send({
    text: `Rewrite it.\ncall edit_item ${JSON.stringify(edit)}`,
  });
  await typeAfter(page, one, " Typed while the agent wrote.");
  const { threadId } = await sending;
  for (const tab of [page, other]) {
    await expect(tab.locator(EDITOR)).toContainText("The agent's own line.");
    await expect(tab.locator(EDITOR)).toContainText(`${one} Typed while the agent wrote.`);
    await expect(tab.locator(EDITOR)).not.toContainText(three);
  }

  await page.getByRole("button", { name: "Info and the agent" }).click();
  await page.getByRole("tab", { name: "Agent" }).click();
  await page.getByRole("list", { name: "Conversations" }).getByRole("button").click();
  const thread = page.locator(`[data-thread="${threadId}"]`);
  await expect(thread.locator("[data-turn-ended]")).toBeVisible();
  // typed in another paragraph, and the undo pressed before the note saves it
  await typeAfter(page, two, " Typed since.");
  await thread.getByRole("button", { name: "Undo this turn" }).click();
  const undone = new RegExp(
    `${one} Typed while the agent wrote\\.[\\s\\S]*${two} Typed since\\.[\\s\\S]*${three}`,
    "u",
  );
  await expect.poll(async () => await markdownOf(library, item.id)).toMatch(undone);
  expect(await markdownOf(library, item.id)).not.toContain("The agent's own line.");
  for (const tab of [page, other]) {
    await expect(tab.locator(EDITOR)).toContainText(three);
    await expect(tab.locator(EDITOR)).toContainText(`${two} Typed since.`);
    await expect(tab.locator(EDITOR)).not.toContainText("The agent's own line.");
  }
});

test("the filing rules start from the starter's and save, and Tidy my library files from Unsorted", async ({
  cloud,
  library,
  page,
}) => {
  const heron = await library.items.createNote({
    markdown: "A bird by the water.",
    title: "Heron",
  });
  await openLibrary(page, cloud);
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByRole("button", { name: "Edit filing rules…" }).click();
  const rules = page.getByRole("textbox", { name: "Filing rules" });
  await expect(rules).toHaveValue(/Unsorted is not a folder: its items are the ones to file\./u);
  await rules.fill("File birds under Birds.");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect
    .poll(async () => await library.agent.rules())
    .toMatchObject({ rules: "File birds under Birds." });
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Library" })
    .click();

  await page.getByRole("button", { name: "Tidy my library" }).click();
  await expect(page.locator("[data-tidy-request]")).toBeVisible();
  await send(
    page,
    `call organize_items ${JSON.stringify({ folder: { path: "Birds" }, ids: [heron.item.id] })}`,
  );
  await expect(page.getByText("Filed items")).toBeVisible();
  const { folders } = await library.organize.outline();
  const birds = folders.find((folder) => folder.name === "Birds");
  const { fields } = await library.items.read({ id: heron.item.id });
  expect(fields.folderId).toBe(birds?.id);
  const [asked] = await sentMessages(library);
  expect(asked?.text).toMatch(/^Tidy my library:[\s\S]*organize_items/u);
  expect(asked?.viewContext).toMatchObject({ scope: { kind: "unsorted" } });
});
