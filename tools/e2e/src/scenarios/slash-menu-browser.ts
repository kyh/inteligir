import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const DOC_PATH = "Plans.md";
const PARAGRAPH = "First paragraph.";
const DOC = `# Plans

${PARAGRAPH}
`;

const HEADING = "Slash heading";
const SAVE_DEADLINE_MS = 15_000;
const OPTION_COUNT = "String(document.querySelectorAll('[role=option]').length)";

export const slashMenuBrowser: Scenario = {
  description: "a typed slash opens the menu, and the picked construct lands in the file",
  name: "slash-menu-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      // sorts before the seeded welcome note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, DOC_PATH), DOC, "utf-8");
      },
    });
    const agentBrowser = await ctx.browser("slash");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);

    ctx.log("putting the caret at the end of the paragraph and opening a fresh block");
    await agentBrowser(["find", "text", PARAGRAPH, "click"]);
    // End can race focus settling, and an Enter from mid-paragraph splits it and the block
    // transform eats the tail.
    const CARET_AT_END =
      "String((() => { const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return false; const r = sel.getRangeAt(0); return r.collapsed && r.endContainer.textContent !== null && r.endOffset === r.endContainer.textContent.length; })())";
    await pollUntil(
      async () => {
        await agentBrowser(["press", "End"]);
        await delay(100);
        return parseEval(await agentBrowser(["eval", CARET_AT_END]), z.string());
      },
      (atEnd) => atEnd === "true",
      { deadlineMs: 15_000, describe: () => "the caret never reached the paragraph's end" },
    );
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
            "JSON.stringify([...document.querySelectorAll('[role=option]')].map((n) => n.textContent))",
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

    ctx.log("and the bytes reach the file");
    const onDisk = await pollUntil(
      async () => await readFile(path.join(app.vaultDir, DOC_PATH), "utf-8"),
      (bytes) => bytes.includes(`## ${HEADING}`),
      {
        deadlineMs: SAVE_DEADLINE_MS,
        describe: (bytes) => `the note never saved; on disk:\n${bytes}`,
      },
    );
    expect(!onDisk.includes("/h2"), `the query text survived the insert:\n${onDisk}`);
    expect(onDisk.includes(PARAGRAPH), `the seeded paragraph was lost:\n${onDisk}`);
  },
};
