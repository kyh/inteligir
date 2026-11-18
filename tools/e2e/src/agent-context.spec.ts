import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { z } from "zod";
import { EDITOR, markdownOf, openLibrary, test, typeAfter } from "./fixtures";

const TextEventSchema = z.looseObject({ text: z.string(), type: z.string() });

// what the person sent or the agent wrote in the account's one conversation, in order
const textsOf = async (library: V1Client["library"], type: "agent.message" | "user.message") => {
  const { threads } = await library.agent.list({});
  const [thread] = threads;
  if (thread === undefined) {
    return [];
  }
  const texts: string[] = [];
  for await (const streamed of await library.agent.events({ threadId: thread.id })) {
    if (streamed.kind === "caughtUp") {
      break;
    }
    const parsed = streamed.kind === "event" ? TextEventSchema.safeParse(streamed.row.event) : null;
    if (parsed?.success === true && parsed.data.type === type) {
      texts.push(parsed.data.text);
    }
  }
  return texts;
};

const send = async (page: Page, text: string) => {
  const composer = page.getByLabel("Message the agent");
  await composer.fill(text);
  await composer.press("Enter");
};

const SENT_FROM = /^Sent from: (?<screen>.*)$/su;

// the screen the model read with a message, as the mock model's `context` line says it back, or
// undefined for none
const screenIn = (reply: string | undefined) => {
  const screen = SENT_FROM.exec(reply ?? "")?.groups?.screen;
  expect(screen).toBeDefined();
  return screen === "nowhere" ? undefined : z.json().parse(JSON.parse(screen ?? "null"));
};

// the screen the model read with the person's next message, once its turn ended: a fresh
// account's day takes two turns, so each test asks twice at most
const screenAsked = (page: Page, library: V1Client["library"]) => async (turns: number) => {
  await send(page, "context");
  await expect(page.locator("[data-thread] [data-turn-ended]")).toHaveCount(turns);
  const replies = await textsOf(library, "agent.message");
  expect(replies).toHaveLength(turns);
  return screenIn(replies.at(-1));
};

test("a message from an open item names the item", async ({ cloud, library, page }) => {
  const plans = await library.items.createNote({ markdown: "A trip in spring.", title: "Plans" });
  await openLibrary(page, cloud, `?item=${plans.item.id}`);
  await page.keyboard.press("ControlOrMeta+K");
  expect(await screenAsked(page, library)(1)).toEqual({ itemId: plans.item.id, surface: "item" });
});

test("a message names the grid's selection it left from, and none from Deleted", async ({
  cloud,
  library,
  page,
}) => {
  const groceries = await library.items.createNote({ markdown: "Apples.", title: "Groceries" });
  const asked = screenAsked(page, library);
  await openLibrary(page, cloud);
  await page
    .getByRole("grid", { name: "Library" })
    .getByRole("gridcell", { name: "Groceries" })
    .click();
  await page.keyboard.press("ControlOrMeta+K");
  expect(await asked(1)).toEqual({
    itemIds: [groceries.item.id],
    scope: { kind: "all" },
    selected: 1,
    surface: "library",
  });

  await page.getByRole("list", { name: "Deleted" }).getByRole("link", { name: "Deleted" }).click();
  expect(await asked(2)).toBeUndefined();
});

test("Undo this turn takes the agent's line back where nothing changed since, and keeps a note typed in since whole, in the cell and both tabs", async ({
  cloud,
  library,
  page,
  secondContext,
}) => {
  const [one, three] = ["A line typed in later.", "A line the agent rewrites."];
  const plans = await library.items.createNote({
    markdown: `# Plans\n\n${one}\n\n${three}\n`,
    title: "Plans",
  });
  const groceries = await library.items.createNote({ markdown: "Apples.\n", title: "Groceries" });
  const other = await secondContext.newPage();
  await openLibrary(page, cloud, `?item=${plans.item.id}`);
  await openLibrary(other, cloud, `?item=${plans.item.id}`);

  const rewrite = {
    edits: [{ newText: "The agent's own line.", oldText: three }],
    id: plans.item.id,
  };
  const swap = { edits: [{ newText: "Pears.", oldText: "Apples." }], id: groceries.item.id };
  const { threadId } = await library.agent.send({
    text: `Rewrite them.\ncall edit_item ${JSON.stringify(rewrite)}\ncall edit_item ${JSON.stringify(swap)}`,
  });
  for (const tab of [page, other]) {
    await expect(tab.locator(EDITOR)).toContainText("The agent's own line.");
  }
  await typeAfter(page, one, " Typed since.");
  await expect.poll(async () => await markdownOf(library, plans.item.id)).toContain("Typed since.");

  for (const tab of [page, other]) {
    await tab.getByRole("button", { name: "Info and the agent" }).click();
    await tab.getByRole("tab", { name: "Agent" }).click();
    await tab.getByRole("list", { name: "Conversations" }).getByRole("button").click();
  }
  const undoOn = (tab: Page) =>
    tab.locator(`[data-thread="${threadId}"]`).getByRole("button", { name: "Undo this turn" });
  await expect(page.locator(`[data-thread="${threadId}"] [data-turn-ended]`)).toBeVisible();
  await expect(undoOn(other)).toBeVisible();
  await undoOn(page).click();

  await expect(
    page.getByText("Undone, but changes made since were kept where they overlapped."),
  ).toBeVisible();
  await expect.poll(async () => await markdownOf(library, groceries.item.id)).toContain("Apples.");
  const plansNow = await markdownOf(library, plans.item.id);
  expect(plansNow).toContain(`${one} Typed since.`);
  expect(plansNow).toContain("The agent's own line.");
  for (const tab of [page, other]) {
    await expect(tab.locator(EDITOR)).toContainText(`${one} Typed since.`);
    await expect(tab.locator(EDITOR)).toContainText("The agent's own line.");
    // what was kept can still be taken back once the change since goes, so the turn keeps its Undo
    await expect(undoOn(tab)).toBeVisible();
  }
});

test("the filing rules start from the starter's and save, Tidy my library files from Unsorted, and the agent reads them", async ({
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
    `call organize_items ${JSON.stringify({ folder: { path: "Birds" }, ids: [heron.item.id] })}\ncontext`,
  );
  await expect(page.getByText("Filed items")).toBeVisible();
  const { folders } = await library.organize.outline();
  const birds = folders.find((folder) => folder.name === "Birds");
  const { fields } = await library.items.read({ id: heron.item.id });
  expect(fields.folderId).toBe(birds?.id);
  const [asked] = await textsOf(library, "user.message");
  expect(asked).toMatch(/^Tidy my library:[\s\S]*organize_items/u);
  const [reply] = await textsOf(library, "agent.message");
  expect(screenIn(reply)).toMatchObject({ scope: { kind: "unsorted" } });

  await send(page, "rules");
  await expect(page.getByText("Filing rules: File birds under Birds.")).toBeVisible();
});
