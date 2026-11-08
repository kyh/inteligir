// Two tabs signed in to one account, the same item open in each: what one types is laid into the
// other, an edit to another block merging with no conflict. A tab whose connection went before its
// pause wrote reads but takes no edit, asks before it goes, and once back sends its edit over the
// base it was typed on: the cell answers CONFLICT, and the editor's diff3 keeps that tab's line and
// says so. A tab that goes out of sight still sends what it holds.

import { setTimeout as delay } from "node:timers/promises";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { z } from "zod";
import { caretToEndOf, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
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
const HIDDEN_B = " Hidden B.";
const OVERLAP = `${TITLE} also changed elsewhere`;
const DEADLINE_MS = 30_000;
// oRPC's status for the CONFLICT a write over a moved base meets
const CONFLICT_STATUS = 409;
// past the editor's pause before it writes what was typed
const PAST_THE_PAUSE_MS = 2000;

// a leave as the browser makes it, without leaving: the page asks first when it prevents it
const LEAVING = `window.dispatchEvent(new Event("beforeunload", { cancelable: true })) ? "goes" : "asks"`;
// the tab goes out of sight, as a switch to another tab or a minimized window makes it
const HIDE = `Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); true`;
const WRITE_PATH = `${V1_RPC_PATH}/library/write`;
// the status of each answer to the open item's writes from here on, read back by WRITES
const WATCH_WRITES = `(() => { const seen = []; window.__writes = seen; const send = window.fetch; window.fetch = async (input, init) => { const response = await send(input, init); if (new URL(input instanceof Request ? input.url : String(input), location.href).pathname === ${JSON.stringify(WRITE_PATH)}) seen.push(response.status); return response; }; return true; })()`;
const WRITES = `JSON.stringify(window.__writes ?? [])`;
const EDITABLE = `String(document.querySelector('${EDITOR}')?.getAttribute("contenteditable"))`;

const leaving = async (browser: AgentBrowser): Promise<string> =>
  parseEval(await browser(["eval", LEAVING]), z.string());

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
    "two tabs on one account with one item open: each one's edit to its own block lands in the cell and is laid into the other; a tab whose connection went before its edit was written takes no more typing and asks before it closes, and once back its edit to a line the other tab changed meets the cell's CONFLICT and settles by the editor's merge, that tab's line kept in the cell and in both tabs, and that tab says both changed it; one gone out of sight right after typing still sends the edit",
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

    ctx.log("B edits line one and loses its connection before the pause; A edits the same line");
    await b(["eval", WATCH_WRITES]);
    await typeAfter(b, LINE_ONE, OFFLINE_B);
    await b(["set", "offline", "on"]);
    await delay(PAST_THE_PAUSE_MS);
    expectEq(
      parseEval(await b(["eval", EDITABLE]), z.string()),
      "false",
      "the editor of a tab with no connection",
    );
    await typeAfter(a.browser, LINE_ONE, ONLINE_A);
    await untilItemText(
      library,
      itemId,
      (markdown) => markdown.includes(ONLINE_A.trim()),
      "A's edit never reached the cell",
    );
    const held = await untilItemText(library, itemId, () => true, "unread");
    expect(!held.includes(OFFLINE_B.trim()), `the offline tab's edit reached the cell:\n${held}`);
    expect(
      (await leaving(b)) === "asks",
      "the offline tab let itself be closed with an edit it had not sent",
    );

    ctx.log("B comes back: the cell refuses its stale write, its line is kept, and B says so");
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
    const answers = parseEval(await b(["eval", WRITES]), z.array(z.number()));
    expect(
      answers.includes(CONFLICT_STATUS),
      `tab B's write never met the cell's CONFLICT; its writes were answered ${answers.join(", ")}`,
    );
    await untilShows(a.browser, `${LINE_ONE}${FROM_A}${OFFLINE_B}`, "A");
    await untilShows(b, `${LINE_ONE}${FROM_A}${OFFLINE_B}`, "B");
    await pollUntil(
      async () => await leaving(b),
      (answer) => answer === "goes",
      {
        deadlineMs: DEADLINE_MS,
        describe: () => "tab B still asks before it closes with everything sent",
      },
    );

    ctx.log("B goes out of sight right after typing: its edit is written and sent all the same");
    await typeAfter(b, LINE_TWO, HIDDEN_B);
    await b(["eval", HIDE]);
    await untilItemText(
      library,
      itemId,
      (markdown) => markdown.includes(`${LINE_TWO}${FROM_B}${HIDDEN_B}`),
      "the edit of a tab gone out of sight never reached the cell",
    );
  },
};
