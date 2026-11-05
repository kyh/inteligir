// Two tabs signed in to one account, the same item open in each: what one types is laid into the
// other, an edit to another block merging with no conflict, and an edit to the same line made
// while one tab was offline settling as the write policy says, that tab's line kept and the person
// told so.

import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { caretToEndOf, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, TOAST_TEXT } from "../harness/selectors";

const TITLE = "Plans";
const LINE_ONE = "Shared line one.";
const LINE_TWO = "Shared line two.";
const DOC = `# ${TITLE}\n\n${LINE_ONE}\n\n${LINE_TWO}\n`;
const FROM_A = " From A.";
const FROM_B = " From B.";
const ONLINE_A = " Online A.";
const OFFLINE_B = " Offline B.";
const OVERLAP = `${TITLE} also changed elsewhere`;
const DEADLINE_MS = 30_000;
// past the editor's pause before it writes what was typed
const PAST_THE_PAUSE_MS = 2000;

const editorText = async (browser: AgentBrowser): Promise<string> =>
  parseEval(
    await browser(["eval", `String(document.querySelector('${EDITOR}')?.textContent ?? "")`]),
    z.string(),
  );

const untilShows = async (browser: AgentBrowser, words: string, tab: string): Promise<void> => {
  await pollUntil(
    async () => await editorText(browser),
    (text) => text.includes(words),
    {
      deadlineMs: DEADLINE_MS,
      describe: (text) => `tab ${tab} never showed "${words}"; its editor holds:\n${text}`,
    },
  );
};

// types at the end of the paragraph that holds `line`
const typeAfter = async (browser: AgentBrowser, line: string, typed: string): Promise<void> => {
  await caretToEndOf(browser, line);
  await browser(["keyboard", "type", typed]);
};

export const syncConflictBrowser: Scenario = {
  description:
    "two tabs on one account with one item open: each one's edit to its own block lands in the cell and is laid into the other; an edit to the same line made while one tab was offline settles once it is back, that tab's line kept in the cell and in both tabs, and that tab says both changed it",
  name: "sync-conflict-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    let itemId = "";
    const path = (): string => `?item=${itemId}`;
    const a = await openLibraryTab(ctx, "conflict-a", {
      path,
      ready: EDITOR,
      seed: async (library) => {
        const { item } = await library.items.createNote({ markdown: DOC, title: TITLE });
        itemId = item.id;
      },
    });
    const { library } = a;
    const b = await ctx.browser("conflict-b");
    await b.openLibrary(a.worker, { path: path(), ready: EDITOR });
    await untilShows(a.browser, LINE_TWO, "A");
    await untilShows(b, LINE_TWO, "B");

    ctx.log("each tab edits a block of its own; both land, and each tab shows the other's");
    await typeAfter(a.browser, LINE_ONE, FROM_A);
    await typeAfter(b, LINE_TWO, FROM_B);
    await untilItemText(
      library,
      itemId,
      (markdown) =>
        markdown.includes(`${LINE_ONE}${FROM_A}`) && markdown.includes(`${LINE_TWO}${FROM_B}`),
      "the two edits never both reached the cell",
    );
    await untilShows(a.browser, `${LINE_TWO}${FROM_B}`, "A");
    await untilShows(b, `${LINE_ONE}${FROM_A}`, "B");

    ctx.log("B goes offline and edits line one; A edits the same line, which lands");
    await b(["set", "offline", "on"]);
    await typeAfter(b, LINE_ONE, OFFLINE_B);
    await delay(PAST_THE_PAUSE_MS);
    await typeAfter(a.browser, LINE_ONE, ONLINE_A);
    await untilItemText(
      library,
      itemId,
      (markdown) => markdown.includes(ONLINE_A.trim()),
      "A's edit never reached the cell",
    );
    const held = await untilItemText(library, itemId, () => true, "unread");
    expect(!held.includes(OFFLINE_B.trim()), `the offline tab's edit reached the cell:\n${held}`);

    ctx.log("B comes back: its line is kept, in the cell and in both tabs, and B says so");
    await b(["set", "offline", "off"]);
    const settled = await untilItemText(
      library,
      itemId,
      (markdown) => markdown.includes(`${LINE_ONE}${FROM_A}${OFFLINE_B}`),
      "the offline tab's line never settled into the cell",
    );
    expect(
      !settled.includes(ONLINE_A.trim()),
      `the line both changed kept the other tab's words too:\n${settled}`,
    );
    expect(
      settled.includes(`${LINE_TWO}${FROM_B}`),
      `the block neither changed was lost:\n${settled}`,
    );
    await pollUntil(
      async () => parseEval(await b(["eval", TOAST_TEXT]), z.string()),
      (text) => text.includes(OVERLAP),
      {
        deadlineMs: DEADLINE_MS,
        describe: (text) => `tab B never said both changed the line; its toasts say:\n${text}`,
      },
    );
    await untilShows(a.browser, `${LINE_ONE}${FROM_A}${OFFLINE_B}`, "A");
    await untilShows(b, `${LINE_ONE}${FROM_A}${OFFLINE_B}`, "B");
  },
};
