import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { caretToEndOf, parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, OPTION, OPTION_COUNT } from "../harness/selectors";

const PARAGRAPH = "First paragraph.";
const DOC = `# Plans

${PARAGRAPH}
`;

const HEADING = "Slash heading";

// slate-react answers a selectionchange on a 100ms throttle, and a person reads the menu before
// typing, so the query is typed after that answer has run
const READS_THE_MENU_MS = 500;
const RACED_HEADING = "Raced heading";

const rowsNow = `JSON.stringify([...document.querySelectorAll('${OPTION}')].map((n) => n.textContent))`;

// one task dispatches every key, so the menu's input mounts only after they reached the editor:
// the race a loaded runner loses at random, run every time
const typedInOneTask = (text: string): string =>
  `(() => { const editor = document.querySelector('${EDITOR}'); for (const data of ${JSON.stringify([...text])}) { editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data, inputType: "insertText" })); } return "typed"; })()`;

export const slashMenuBrowser: Scenario = {
  description:
    "a typed slash opens the menu, and the picked construct lands in the item, a query typed before the menu's input has focus included",
  name: "slash-menu-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    let itemId = "";
    ctx.log("opening the item by its deep link");
    const { browser: agentBrowser, library } = await openLibraryTab(ctx, "slash", {
      path: () => `?item=${itemId}`,
      ready: EDITOR,
      seed: async (seeding) => {
        const { item } = await seeding.items.createNote({ markdown: DOC, title: "Plans" });
        itemId = item.id;
      },
    });

    ctx.log("putting the caret at the end of the paragraph and opening a fresh block");
    // an Enter from mid-paragraph splits it, and the block transform eats the tail
    await caretToEndOf(agentBrowser, PARAGRAPH);
    await agentBrowser(["press", "Enter"]);

    ctx.log("typing the slash");
    await agentBrowser(["type", EDITOR, "/"]);
    // the combobox portals outside the layout flow, which headless treats as not-visible, so
    // `wait` never resolves.
    await pollUntil(
      async () => parseEval(await agentBrowser(["eval", OPTION_COUNT]), z.string()),
      (count) => count !== "0",
      { deadlineMs: 15_000, describe: () => "the slash menu never opened" },
    );

    ctx.log("narrowing to one row by its query, typed once the menu has been read");
    await delay(READS_THE_MENU_MS);
    await agentBrowser(["press", "h"]);
    await agentBrowser(["press", "2"]);
    // narrowing re-renders the portal'd rows; one settle tick is not a bound under full-suite
    // load.
    const untilOnlyRow = async (label: string): Promise<void> => {
      await pollUntil(
        async () => parseEval(await agentBrowser(["eval", rowsNow]), z.array(z.string())),
        (rows) => rows.length === 1 && (rows[0] ?? "").startsWith(label),
        { deadlineMs: 15_000, describe: (rows) => `the query left ${JSON.stringify(rows)}` },
      );
    };
    await untilOnlyRow("Heading 2");

    ctx.log("Enter applies it, and typing lands inside the new heading");
    await agentBrowser(["press", "Enter"]);
    await agentBrowser(["type", EDITOR, HEADING]);

    const menuGone = parseEval(await agentBrowser(["eval", OPTION_COUNT]), z.string());
    expectEq(menuGone, "0", "slash rows left open after applying");

    const isHeading = await agentBrowser([
      "eval",
      `JSON.stringify([...document.querySelectorAll('${EDITOR} h2')].map((n) => n.textContent))`,
    ]);
    expect(
      isHeading.includes(HEADING),
      `the inserted block did not render as a heading — got: ${isHeading}`,
    );

    ctx.log("and the heading reaches the cell");
    const saved = await untilItemText(
      library,
      itemId,
      (markdown) => markdown.includes(`## ${HEADING}`),
      "the heading never reached the cell",
    );
    expect(!saved.includes("/h2"), `the query text survived the insert:\n${saved}`);
    expect(saved.includes(PARAGRAPH), `the seeded paragraph was lost:\n${saved}`);

    ctx.log("a query typed before the menu's input has focus narrows it the same");
    await caretToEndOf(agentBrowser, HEADING);
    await agentBrowser(["press", "Enter"]);
    await agentBrowser(["eval", typedInOneTask("/h3")]);
    await untilOnlyRow("Heading 3");
    await agentBrowser(["press", "Enter"]);
    await agentBrowser(["type", EDITOR, RACED_HEADING]);
    const raced = await untilItemText(
      library,
      itemId,
      (markdown) => markdown.includes(`### ${RACED_HEADING}`),
      "the raced heading never reached the cell",
    );
    expect(!raced.includes("/h3"), `the raced query survived the insert:\n${raced}`);
  },
};
