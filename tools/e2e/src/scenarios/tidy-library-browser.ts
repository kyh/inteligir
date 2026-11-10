// Tidy my library and the filing rules in the tab, against the scripted Claude the Worker is bound
// to: Settings' filing rules open on the starter rules, which say Unsorted is no folder, and save
// the person's own into the cell; the grid's Tidy my library opens the panel's composer on its
// request, sent from Unsorted with what the person added, and the turn it starts files the item.

import { z } from "zod";
import { clickButtonIn, modChord, untilBodyHolds } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER, libraryCard } from "../harness/selectors";

const TIDY = "Tidy my library";
const RULES = "File birds under Birds.";
const RULES_FIELD = 'textarea[aria-label="Filing rules"]';
const BIRDS = "Birds";
const DEADLINE_MS = 60_000;

// what the cell keeps of the person's message, as much of it as is asserted on
const userMessageSchema = z.looseObject({
  text: z.string(),
  type: z.literal("user.message"),
  viewContext: z.looseObject({ scope: z.looseObject({ kind: z.string() }) }),
});

export const tidyLibraryBrowser: Scenario = {
  description:
    "in the tab, against a scripted Claude: Settings' filing rules open on the starter rules and save the person's into the cell; the grid's Tidy my library opens the composer on its request, sent from Unsorted with what the person added, and its turn files the item into a folder",
  name: "tidy-library-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const {
      browser,
      library,
      seeded: heronId,
    } = await openLibraryTab(ctx, "tidy", async (seeding) => {
      const { item } = await seeding.items.createNote({
        markdown: "A bird by the water.",
        title: "Heron",
      });
      return item.id;
    });
    await browser(["wait", libraryCard(heronId)], DEADLINE_MS);

    ctx.log("Settings' filing rules open on the starter rules, and save the person's");
    await browser(["press", modChord(",")]);
    await clickButtonIn(browser, "#account", "Edit filing rules…", DEADLINE_MS);
    await browser(["wait", RULES_FIELD], DEADLINE_MS);
    const starter = await browser(["get", "value", RULES_FIELD]);
    expect(
      starter.includes("Unsorted is not a folder: its items are the ones to file."),
      `the starter rules never said Unsorted is no folder:\n${starter}`,
    );
    await browser(["fill", RULES_FIELD, RULES]);
    await clickButtonIn(browser, '[role="dialog"]', "Save");
    await pollUntil(
      async () => await library.agent.rules(),
      (answer) => answer.rules === RULES,
      { deadlineMs: DEADLINE_MS, describe: (answer) => `the cell keeps ${String(answer.rules)}` },
    );
    await clickButtonIn(browser, 'nav[aria-label="Settings"]', "Library");

    ctx.log("the grid's Tidy my library opens the composer on its request, and sends it");
    await clickButtonIn(browser, "[data-library-scope]", TIDY, DEADLINE_MS);
    await browser(["wait", "[data-tidy-request]"], DEADLINE_MS);
    await browser([
      "fill",
      COMPOSER,
      `call organize_items ${JSON.stringify({ folder: { path: BIRDS }, ids: [heronId] })}`,
    ]);
    await browser(["press", "Enter"]);
    await browser(["wait", "[data-thread] [data-turn-ended]"], DEADLINE_MS);
    await untilBodyHolds(browser, ["Filed items", "Undo this turn"]);

    ctx.log("the turn filed the item, asked from Unsorted with the request and what was added");
    const outline = await library.organize.outline();
    const birds = outline.folders.find((folder) => folder.name === BIRDS);
    expect(birds !== undefined, `the cell holds no folder "${BIRDS}"`);
    const { fields } = await library.items.read({ id: heronId });
    expect(fields.folderId === birds.id, `the item stayed in ${String(fields.folderId)}`);
    const { threads } = await library.agent.list({});
    const [thread] = threads;
    expect(thread !== undefined, "the Tidy made no conversation");
    const { events } = await library.agent.events({ threadId: thread.id });
    const asked = events
      .map((row) => userMessageSchema.safeParse(row.event))
      .find((parsed) => parsed.success)?.data;
    expect(asked !== undefined, "the conversation holds no message of the person's");
    expect(
      asked.text.startsWith(`${TIDY}:`) && asked.text.includes("organize_items"),
      `the message was not the request with what was added:\n${asked.text}`,
    );
    expect(asked.viewContext.scope.kind === "unsorted", "the Tidy was not asked from Unsorted");
  },
};
