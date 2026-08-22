// The slash menu driven by a REAL browser, end to end: real keystrokes open
// the Plate slash combobox on an empty paragraph, the query narrows it to one
// row, Enter applies it, and the construct that lands is serialized to the
// file. The unit suite proves the kit under jsdom; only this proves a "/"
// typed on a keyboard reaches it through the bundle and Slate's DOM reader.
//
// The last assertion is the one that matters most: a menu that inserted the
// right element and the wrong bytes is a bug only the file can show.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("slash");
const DOC_PATH = "Plans.md";
const PARAGRAPH = "First paragraph.";
const DOC = `# Plans

${PARAGRAPH}
`;

/** agent-browser eval answers a JSON-encoded string (page evals always yield
 *  strings via String()/JSON.stringify); unwrap, then parse the payload at
 *  this boundary against the schema the caller expects. */
function parseEval<T>(raw: string, schema: z.ZodType<T>): T {
  const text = z.string().parse(JSON.parse(raw));
  return schema.parse(/^[{[]/u.test(text) ? JSON.parse(text) : text);
}

const HEADING = "Slash heading";
const SAVE_DEADLINE_MS = 15_000;
const EDITOR = '[data-slate-editor="true"]';

export const slashMenuBrowser: Scenario = {
  name: "slash-menu-browser",
  description: "a typed slash opens the menu, and the picked construct lands in the file",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      // Sorts before the seeded welcome note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, DOC_PATH), DOC, "utf8");
      },
    });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);

      ctx.log("putting the caret at the end of the paragraph and opening a fresh block");
      await agentBrowser(["find", "text", PARAGRAPH, "click"]);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["press", "Enter"]);

      ctx.log("typing the slash");
      await agentBrowser(["type", EDITOR, "/"]);
      // The combobox portals outside the layout flow, which headless treats
      // as not-visible — `wait` never resolves on it, so poll the DOM count.
      const OPTS = "String(document.querySelectorAll('[role=option]').length)";
      const menuDeadline = Date.now() + 15_000;
      for (;;) {
        if (parseEval(await agentBrowser(["eval", OPTS]), z.string()) !== "0") {
          break;
        }
        expect(Date.now() < menuDeadline, "the slash menu never opened");
        await delay(250);
      }

      ctx.log("narrowing to one row by its query");
      await agentBrowser(["press", "h"]);
      await agentBrowser(["press", "2"]);
      await delay(250);
      const rows = parseEval(
        await agentBrowser([
          "eval",
          "JSON.stringify([...document.querySelectorAll('[role=option]')].map((n) => n.textContent))",
        ]),
        z.array(z.string()),
      );
      expect(
        rows.length === 1 && (rows[0] ?? "").startsWith("Heading 2"),
        `the query left ${JSON.stringify(rows)}`,
      );

      ctx.log("Enter applies it, and typing lands inside the new heading");
      await agentBrowser(["press", "Enter"]);
      await agentBrowser(["type", EDITOR, HEADING]);

      const menuGone = parseEval(
        await agentBrowser(["eval", "String(document.querySelectorAll('[role=option]').length)"]),
        z.string(),
      );
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
      const deadline = Date.now() + SAVE_DEADLINE_MS;
      let onDisk = "";
      for (;;) {
        onDisk = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
        if (onDisk.includes(`## ${HEADING}`)) {
          break;
        }
        expect(Date.now() < deadline, `the note never saved; on disk:\n${onDisk}`);
        await delay(250);
      }
      // No stray query text, and the paragraph the caret started on survives.
      expect(!onDisk.includes("/h2"), `the query text survived the insert:\n${onDisk}`);
      expect(onDisk.includes(PARAGRAPH), `the seeded paragraph was lost:\n${onDisk}`);
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
