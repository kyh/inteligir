// One note open in two tabs of one account, its body a live document: what either tab types shows
// in the other as it is typed; a turn of the built-in agent edits the note while a tab types, and
// its "Undo this turn" takes the agent's words back in both tabs and keeps the typing; a reload
// draws what was typed; the library's search finds a word typed a moment ago once the note's save
// lands; and the note opened from Deleted reads but takes no edit.

import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { z } from "zod";
import {
  caretToEndOf,
  clickButtonIn,
  parseEval,
  press,
  untilEditorHolds,
} from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText, untilThreadStatus } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const TITLE = "Plans";
const LINE_ONE = "Shared line one.";
const LINE_TWO = "Shared line two.";
const LINE_THREE = "A line the agent rewrites.";
const DOC = `# ${TITLE}\n\n${LINE_ONE}\n\n${LINE_TWO}\n\n${LINE_THREE}\n`;
const FROM_A = " From A.";
const FROM_B = " From B.";
const AGENT_LINE = "The agent's own line.";
const WHILE_AGENT = " Typed while the agent wrote.";
const AFTER_RELOAD = " Typed before the reload.";
// one word no other text holds, so a hit is the word typed
const SEARCHED = "Quillfeather";
// the editor's words for a note in Deleted (packages/editor/src/item/item-editor.tsx)
const IN_DELETED = "This item is in Deleted.";
const PANEL_TOGGLE = 'button[aria-label="Info and the agent"]';
const PANEL = '[data-side="right"]';
const EDITABLE = `String(document.querySelector('${EDITOR}')?.getAttribute("contenteditable"))`;
const DEADLINE_MS = 30_000;
const itemPath = (id: string): string => `?item=${id}`;

const untilShows = async (
  browser: AgentBrowser,
  tab: string,
  holds: (text: string) => boolean,
  what: string,
): Promise<void> => {
  await untilEditorHolds(browser, holds, `tab ${tab} never showed ${what}`, DEADLINE_MS);
};

const typeAfter = async (browser: AgentBrowser, line: string, typed: string): Promise<void> => {
  await caretToEndOf(browser, line);
  await browser(["keyboard", "type", typed]);
};

export const liveNoteBrowser: Scenario = {
  description:
    "one note open in two tabs of one account: what either tab types shows in the other; a built-in agent's turn edits the note while a tab types, both tabs show both, and its Undo this turn takes the agent's line back in the library and both tabs and keeps the typing; a reload draws what was typed; the library's search finds a word typed a moment ago; and the note opened from Deleted says so and takes no edit",
  name: "live-note-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const a = await openLibraryTab(
      ctx,
      "live-a",
      async (library) => {
        const { item } = await library.items.createNote({ markdown: DOC, title: TITLE });
        return item.id;
      },
      { path: itemPath, ready: EDITOR },
    );
    const { library, seeded: itemId, worker } = a;
    const b = await ctx.browser("live-b");
    await b.openLibrary(worker, { path: itemPath(itemId), ready: EDITOR });
    const opened = (text: string): boolean => text.includes(LINE_THREE);
    await untilShows(a.browser, "A", opened, "the note");
    await untilShows(b, "B", opened, "the note");

    ctx.log("what each tab types shows in the other, and reaches the library");
    await typeAfter(a.browser, LINE_ONE, FROM_A);
    await untilShows(b, "B", (text) => text.includes(`${LINE_ONE}${FROM_A}`), "A's typing");
    await typeAfter(b, LINE_TWO, FROM_B);
    await untilShows(a.browser, "A", (text) => text.includes(`${LINE_TWO}${FROM_B}`), "B's typing");
    await untilItemText(
      library,
      itemId,
      (markdown) =>
        markdown.includes(`${LINE_ONE}${FROM_A}`) && markdown.includes(`${LINE_TWO}${FROM_B}`),
      "the two tabs' typing never both reached the library",
    );

    ctx.log("a turn of the agent rewrites a line while tab A types in another");
    const edit = { edits: [{ newText: AGENT_LINE, oldText: LINE_THREE }], id: itemId };
    const sending = library.agent.send({
      text: `Rewrite the last line.\ncall edit_item ${JSON.stringify(edit)}`,
    });
    await typeAfter(a.browser, `${LINE_ONE}${FROM_A}`, WHILE_AGENT);
    const { threadId } = await sending;
    await untilThreadStatus(library, threadId, "idle");
    const both = (text: string): boolean =>
      text.includes(AGENT_LINE) && text.includes(WHILE_AGENT.trim()) && !text.includes(LINE_THREE);
    await untilShows(a.browser, "A", both, "the agent's line beside the typing");
    await untilShows(b, "B", both, "the agent's line beside the typing");

    ctx.log("Undo this turn takes the agent's line back and keeps what tab A typed");
    await a.browser(["click", PANEL_TOGGLE]);
    // pressed where it is, not where a pointer finds it: the panel slides in as it opens
    await clickButtonIn(a.browser, PANEL, "Agent");
    await press(a.browser, `[data-thread-id="${threadId}"]`);
    await a.browser(["wait", `[data-thread="${threadId}"] [data-turn-ended]`], DEADLINE_MS);
    await clickButtonIn(a.browser, `[data-thread="${threadId}"]`, "Undo this turn");
    const undone = (text: string): boolean =>
      text.includes(LINE_THREE) &&
      text.includes(`${LINE_ONE}${FROM_A}${WHILE_AGENT}`) &&
      text.includes(`${LINE_TWO}${FROM_B}`) &&
      !text.includes(AGENT_LINE);
    await untilItemText(library, itemId, undone, "the library never held the undo");
    await untilShows(a.browser, "A", undone, "the undo");
    await untilShows(b, "B", undone, "the undo");

    ctx.log("a reload draws what was typed just before it");
    await typeAfter(b, `${LINE_TWO}${FROM_B}`, AFTER_RELOAD);
    await b(["reload"]);
    await b(["wait", EDITOR], DEADLINE_MS);
    await untilShows(
      b,
      "B",
      (text) => text.includes(AFTER_RELOAD.trim()) && text.includes(LINE_THREE),
      "the typing after its reload",
    );

    ctx.log("the library's search finds a word typed a moment ago");
    await typeAfter(a.browser, LINE_THREE, ` ${SEARCHED}.`);
    await pollUntil(
      async () => {
        const { hits } = await library.search({ query: SEARCHED });
        return hits.map((hit) => hit.id);
      },
      (ids) => ids.includes(itemId),
      {
        deadlineMs: DEADLINE_MS,
        describe: (ids) => `the search never found the word typed: it found ${JSON.stringify(ids)}`,
      },
    );

    ctx.log("moved to Deleted, the note opens read-only and says why");
    await library.items.delete({ ids: [itemId] });
    await b(["open", `${worker.origin}${LIBRARY_PAGE_PATH}${itemPath(itemId)}`]);
    await b(["wait", EDITOR], DEADLINE_MS);
    await pollUntil(
      async () => await b(["get", "text", "body"]),
      (body) => body.includes(IN_DELETED),
      {
        deadlineMs: DEADLINE_MS,
        describe: (body) => `the note in Deleted never said so:\n${body}`,
      },
    );
    await untilShows(b, "B", (text) => text.includes(SEARCHED), "the note in Deleted");
    await pollUntil(
      async () => parseEval(await b(["eval", EDITABLE]), z.string()),
      (value) => value === "false",
      {
        deadlineMs: DEADLINE_MS,
        describe: (value) => `the note in Deleted took edits: contenteditable ${value}`,
      },
    );
  },
};
