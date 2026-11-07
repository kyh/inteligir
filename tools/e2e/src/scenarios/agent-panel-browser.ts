// The built-in agent in the tab's panel, against the scripted Claude the Worker is bound to: a
// message sent from the composer is a conversation of the account's, its turn's work drawn as it
// lands; a deletion it asks for waits on the person's Approve; Undo this conversation takes every
// turn back at once; and a send past the day's allowance says so in the person's words.

import { modChord, clickButtonIn, untilBodyHolds } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab } from "../harness/library-tab";
import type { Library } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER, libraryCard } from "../harness/selectors";

// a day of two turns, so the third send meets the allowance
const ALLOWANCE = { concurrentTurns: 2, dayCents: 1000, dayTurns: 2, turnCents: 50 };
const BIN = { markdown: "# Bin me\n\nThe agent deletes this.\n", title: "Bin me" };
const DEADLINE_MS = 60_000;

const isDeleted = async (library: Library, id: string): Promise<boolean> => {
  const { fields } = await library.items.read({ id });
  return fields.deletedAt !== null;
};

const untilDeleted = async (library: Library, id: string, deleted: boolean): Promise<void> => {
  await pollUntil(
    async () => await isDeleted(library, id),
    (now) => now === deleted,
    {
      deadlineMs: DEADLINE_MS,
      describe: () => `${id} is ${deleted ? "still in the library" : "still in Deleted"}`,
    },
  );
};

// the agent's change sets, newest first
const agentSets = async (library: Library) => {
  const { changeSets } = await library.history.list({});
  return changeSets.filter((set) => set.actor === "agent");
};

export const agentPanelBrowser: Scenario = {
  description:
    "in the tab, against a scripted Claude: ⌘K opens the panel's composer, a sent message becomes the account's conversation with its turn's work drawn, the note it writes reaches the grid; a deletion it asks for waits on Approve and runs once allowed; Undo this conversation takes both turns back; and a send past the day's allowance is refused in the person's words",
  name: "agent-panel-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    let binId = "";
    const { browser, library } = await openLibraryTab(ctx, "agent-panel", {
      seed: async (seeding) => {
        const { item } = await seeding.items.createNote(BIN);
        binId = item.id;
      },
      worker: { json: { AGENT_ALLOWANCE: ALLOWANCE } },
    });
    await browser(["wait", libraryCard(binId)], DEADLINE_MS);

    ctx.log("⌘K opens the composer, and a message becomes a conversation");
    await browser(["press", modChord("k")]);
    await browser(["wait", COMPOSER], DEADLINE_MS);
    await browser([
      "fill",
      COMPOSER,
      'Make a note.\ncall create_note {"markdown":"Paris in spring."}',
    ]);
    await browser(["press", "Enter"]);
    await browser(["wait", "[data-thread] [data-turn-ended]"], DEADLINE_MS);
    await untilBodyHolds(browser, ["Wrote a note", "Undo this turn"]);
    const [made] = await agentSets(library);
    const madeId = made?.items[0]?.id;
    expect(madeId !== undefined, "the turn made no change set naming its note");
    await browser(["wait", libraryCard(madeId)], DEADLINE_MS);

    ctx.log("a deletion the agent asks for waits for Approve, then runs");
    await browser(["fill", COMPOSER, `call delete_items ${JSON.stringify({ ids: [binId] })}`]);
    await browser(["press", "Enter"]);
    await browser(["wait", "[data-approval]"], DEADLINE_MS);
    expect(!(await isDeleted(library, binId)), "the deletion ran before the person answered");
    await clickButtonIn(browser, "[data-approval]", "Approve");
    await untilDeleted(library, binId, true);
    await pollUntil(
      async () => await browser(["get", "count", libraryCard(binId)]),
      (count) => count.trim() === "0",
      { deadlineMs: DEADLINE_MS, describe: () => "the deleted item's card stayed in the grid" },
    );

    ctx.log("Undo this conversation takes both turns back");
    await pollUntil(
      async () => await agentSets(library),
      (sets) => sets.length === 2,
      {
        deadlineMs: DEADLINE_MS,
        describe: (sets) => `the agent made ${String(sets.length)} change sets`,
      },
    );
    await clickButtonIn(browser, "[data-agent-panel]", "Undo this conversation", DEADLINE_MS);
    await untilDeleted(library, binId, false);
    await untilDeleted(library, madeId, true);
    await browser(["wait", libraryCard(binId)], DEADLINE_MS);

    ctx.log("a send past the day's allowance says so");
    await browser(["fill", COMPOSER, "One more."]);
    await browser(["press", "Enter"]);
    await untilBodyHolds(browser, ["The agent has used today’s allowance"]);
  },
};
