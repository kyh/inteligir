// The screen a message leaves from, end to end: a send from the tab's agent panel reaches the cell
// carrying the view context the page built, stored on the conversation's user message as every
// device reads it, against the scripted Claude the Worker is bound to. From an open item it names
// the item; from the grid, the scope and the card selected; from Deleted, nothing.

import { z } from "zod";

import { clickStartingWith, modChord } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab } from "../harness/library-tab";
import type { Library } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { BACK_TO_LIBRARY, COMPOSER, EDITOR, clickCard, libraryCard } from "../harness/selectors";

const PLANS = { markdown: "# Plans\n\nA trip in spring.\n", title: "Plans" };
const GROCERIES = { markdown: "# Groceries\n\nApples.\n", title: "Groceries" };
const DEADLINE_MS = 60_000;
// a day of more turns than the scenario sends, so no send meets the allowance
const ALLOWANCE = { concurrentTurns: 2, dayCents: 1000, dayTurns: 10 };

const userMessageSchema = z.looseObject({
  text: z.string(),
  type: z.literal("user.message"),
  viewContext: z.json().optional(),
});

// the account's one conversation, and the person's messages in it, in the order they were sent
const sentMessages = async (library: Library) => {
  const { threads } = await library.agent.list({});
  const [thread] = threads;
  if (thread === undefined) {
    return [];
  }
  const { events } = await library.agent.events({ limit: 500, threadId: thread.id });
  return events.flatMap((row) => {
    const parsed = userMessageSchema.safeParse(row.event);
    return parsed.success ? [parsed.data] : [];
  });
};

// sends from the composer and waits for the cell to hold that many of the person's messages,
// and for the tab to draw that many ended turns
const sendAndSettle = async (
  browser: AgentBrowser,
  library: Library,
  text: string,
  sent: number,
) => {
  await browser(["fill", COMPOSER, text]);
  await browser(["press", "Enter"]);
  const messages = await pollUntil(
    async () => await sentMessages(library),
    (held) => held.length === sent,
    {
      deadlineMs: DEADLINE_MS,
      describe: (held) => `the cell holds ${String(held.length)} of ${String(sent)} messages`,
    },
  );
  await pollUntil(
    async () => await browser(["get", "count", "[data-thread] [data-turn-ended]"]),
    (count) => count.trim() === String(sent),
    { deadlineMs: DEADLINE_MS, describe: (count) => `${count.trim()} turns drawn as ended` },
  );
  const message = messages.at(-1);
  expect(message !== undefined, "the cell holds no message");
  expectEq(message.text, text, "the stored message's words");
  return message.viewContext;
};

export const viewContextBrowser: Scenario = {
  description:
    "the agent is told which screen a message left from: an open item by its id, the grid by its scope and the card selected, and Deleted not at all, as the cell stores each on the conversation",
  name: "view-context-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const {
      browser,
      library,
      seeded: { groceriesId, plansId },
    } = await openLibraryTab(
      ctx,
      "view-context",
      async (seeding) => {
        const plans = await seeding.items.createNote(PLANS);
        const groceries = await seeding.items.createNote(GROCERIES);
        return { groceriesId: groceries.item.id, plansId: plans.item.id };
      },
      {
        path: (seeded) => `?item=${seeded.plansId}`,
        ready: EDITOR,
        worker: { json: { AGENT_ALLOWANCE: ALLOWANCE } },
      },
    );

    ctx.log("a message from an open item names the item");
    await browser(["press", modChord("k")]);
    await browser(["wait", COMPOSER], DEADLINE_MS);
    const fromItem = await sendAndSettle(browser, library, "Make this shorter.", 1);
    expectEq(fromItem, { itemId: plansId, surface: "item" }, "the view context of an open item");

    ctx.log("a message from the grid names its scope and the card selected");
    await browser(["click", BACK_TO_LIBRARY]);
    await browser(["wait", libraryCard(groceriesId)], DEADLINE_MS);
    expectEq(await browser(["eval", clickCard(groceriesId)]), '"clicked"', "the card's click");
    const fromGrid = await sendAndSettle(browser, library, "What is this one?", 2);
    expectEq(
      fromGrid,
      { itemIds: [groceriesId], scope: { kind: "all" }, selected: 1, surface: "library" },
      "the view context of the grid",
    );

    ctx.log("a message from Deleted names no screen");
    await clickStartingWith(browser, '[aria-label="Deleted"]', "Deleted");
    const fromDeleted = await sendAndSettle(browser, library, "Anything here?", 3);
    expect(fromDeleted === undefined, `a send from Deleted carried ${JSON.stringify(fromDeleted)}`);
  },
};
