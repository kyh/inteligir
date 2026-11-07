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

export const slashMenuBrowser: Scenario = {
  description: "a typed slash opens the menu, and the picked construct lands in the item",
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

    ctx.log("narrowing to one row by its query");
    await agentBrowser(["press", "h"]);
    await agentBrowser(["press", "2"]);
    // narrowing re-renders the portal'd rows; one settle tick is not a bound under full-suite
    // load.
    await pollUntil(
      async () =>
        parseEval(
          await agentBrowser([
            "eval",
            `JSON.stringify([...document.querySelectorAll('${OPTION}')].map((n) => n.textContent))`,
          ]),
          z.array(z.string()),
        ),
      (rows) => rows.length === 1 && (rows[0] ?? "").startsWith("Heading 2"),
      { deadlineMs: 15_000, describe: (rows) => `the query left ${JSON.stringify(rows)}` },
    );

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
  },
};
