// Undo in the tab, over the cell's change sets: a turn of the built-in agent rewrites a line of the
// open item, and the conversation's "Undo this turn", pressed right after a line the person typed
// since and before the note's save, takes the agent's line back and keeps the person's.

import { z } from "zod";
import { caretToEndOf, clickButtonIn, parseEval, press } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import type { Library } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const TITLE = "Draft";
const FIRST = "First draft.";
const SECOND = "Second draft.";
const KEPT = "Keep this paragraph.";
const TYPED = " Typed since.";
const DOC = `# ${TITLE}\n\n${FIRST}\n\n${KEPT}\n`;
const PANEL_TOGGLE = 'button[aria-label="Info and the agent"]';
const PANEL = '[data-side="right"]';
const DEADLINE_MS = 30_000;

const editorText = async (browser: AgentBrowser): Promise<string> =>
  parseEval(
    await browser(["eval", `String(document.querySelector('${EDITOR}')?.textContent ?? "")`]),
    z.string(),
  );

const untilEditor = async (
  browser: AgentBrowser,
  holds: (text: string) => boolean,
  what: string,
): Promise<void> => {
  await pollUntil(async () => await editorText(browser), holds, {
    deadlineMs: DEADLINE_MS,
    describe: (text) => `${what}; the editor holds:\n${text}`,
  });
};

// the account's conversation, once its turn has ended
const untilIdle = async (library: Library, threadId: string): Promise<void> => {
  await pollUntil(
    async () => {
      const { threads } = await library.agent.list({});
      return threads.find((thread) => thread.id === threadId)?.status ?? null;
    },
    (status) => status === "idle",
    {
      deadlineMs: DEADLINE_MS,
      describe: (status) => `the turn never ended: the thread is ${String(status)}`,
    },
  );
};

export const undoBrowser: Scenario = {
  description:
    "in the tab: a built-in agent's turn rewrites a line of the open item; its Undo this turn, pressed right after a line typed elsewhere in the item and before the note saved it, takes the agent's line back and keeps the typed one, in the cell and the editor",
  name: "undo-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    let itemId = "";
    const { browser, library } = await openLibraryTab(ctx, "undo", {
      path: () => `?item=${itemId}`,
      ready: EDITOR,
      seed: async (seeding) => {
        const { item } = await seeding.items.createNote({ markdown: DOC, title: TITLE });
        itemId = item.id;
      },
    });
    await untilEditor(browser, (text) => text.includes(KEPT), "the item never opened");

    ctx.log("a turn of the agent rewrites the first line, and the open item shows it");
    const edit = { edits: [{ newText: SECOND, oldText: FIRST }], id: itemId };
    const { threadId } = await library.agent.send({
      text: `Rewrite the draft.\ncall edit_item ${JSON.stringify(edit)}`,
    });
    await untilIdle(library, threadId);
    await untilEditor(browser, (text) => text.includes(SECOND), "the agent's line never showed");

    ctx.log("the conversation is in the panel, its turn offering Undo this turn");
    await browser(["click", PANEL_TOGGLE]);
    // pressed where it is, not where a pointer finds it: the panel slides in as it opens
    await clickButtonIn(browser, PANEL, "Agent");
    await press(browser, `[data-thread-id="${threadId}"]`);
    await browser(["wait", `[data-thread="${threadId}"] [data-turn-ended]`], DEADLINE_MS);

    ctx.log("a line typed in another paragraph, and Undo this turn before the note saves it");
    await caretToEndOf(browser, KEPT);
    await browser(["keyboard", "type", TYPED]);
    await clickButtonIn(browser, `[data-thread="${threadId}"]`, "Undo this turn");
    const kept = (text: string): boolean =>
      text.includes(FIRST) && text.includes(`${KEPT}${TYPED}`) && !text.includes(SECOND);
    await untilItemText(
      library,
      itemId,
      kept,
      "the cell never held the first line and the typed one",
    );
    await untilEditor(browser, kept, "the editor never showed the first line and the typed one");
  },
};
