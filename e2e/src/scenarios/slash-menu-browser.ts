// The slash menu driven by a REAL browser, end to end: real keystrokes open
// it at a block-empty line, the query narrows it to one row, Enter applies it,
// and the construct that lands is decorated by the editor AND saved to the
// file. The unit suite drives dispatched transactions under jsdom, so it can
// prove the state machine and never that a `/` typed on a keyboard reaches it
// through the bundle, the keymap and CodeMirror's own DOM-mutation reader —
// which is exactly where a coalesced burst would have broken it.
//
// The last assertion is the one that matters most: the buffer IS the file, so
// a menu that inserted the right decoration and the wrong bytes would be a
// bug this scenario is the only place to catch.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("slash");
const DOC_PATH = "Plans.md";
const PARAGRAPH = "First paragraph.";
const DOC = `# Plans

${PARAGRAPH}
`;
const HEADING = "Slash heading";
const SAVE_DEADLINE_MS = 15_000;
/** The third rendered line of the seeded doc is the paragraph. */
const PARAGRAPH_LINE = ".cm-content .cm-line:nth-child(3)";

export const slashMenuBrowser: Scenario = {
  name: "slash-menu-browser",
  description: "a typed slash opens the menu, and the picked construct lands in the file",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      // The only root note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, DOC_PATH), DOC, "utf8");
      },
    });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", ".cm-content"], 90_000);
      await agentBrowser(["wait", PARAGRAPH_LINE], 90_000);

      // Two returns, not one: the line directly under a paragraph lazily
      // continues it, so only the second lands on a line where a block can
      // begin — which is the rule the menu is asking the tree about.
      ctx.log("putting the caret on a block-empty line");
      await agentBrowser(["click", PARAGRAPH_LINE]);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["press", "Enter"]);
      await agentBrowser(["press", "Enter"]);

      ctx.log("typing the slash");
      await agentBrowser(["keyboard", "type", "/"]);
      await agentBrowser(["wait", ".cm-slash-row"], 30_000);

      ctx.log("narrowing to one row by its keyword");
      await agentBrowser(["keyboard", "type", "h1"]);
      const rows: unknown = JSON.parse(
        await agentBrowser([
          "eval",
          "[...document.querySelectorAll('.cm-slash-row')].map((n) => n.dataset.slashItem)",
        ]),
      );
      expectEq(JSON.stringify(rows), '["heading-1"]', "the rows the query left");

      ctx.log("Enter applies it in one transaction");
      await agentBrowser(["press", "Enter"]);
      await agentBrowser(["keyboard", "type", HEADING]);

      const menuGone = await agentBrowser(["get", "count", ".cm-slash-row"]);
      expectEq(menuGone, "0", "slash rows left open after applying");

      ctx.log("the editor decorates what the menu inserted");
      await agentBrowser(["wait", ".cm-heading-hang"], 30_000);
      const headings = await agentBrowser([
        "eval",
        "[...document.querySelectorAll('.cm-content .cm-heading-hang')].map((n) => n.textContent)",
      ]);
      expect(
        headings.includes(`# ${HEADING}`),
        `the inserted heading is not decorated — got: ${headings}`,
      );

      ctx.log("and the bytes reach the file: the buffer IS the file");
      const deadline = Date.now() + SAVE_DEADLINE_MS;
      let onDisk = "";
      for (;;) {
        onDisk = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
        if (onDisk.includes(`# ${HEADING}`)) {
          break;
        }
        expect(Date.now() < deadline, `the note never saved; on disk:\n${onDisk}`);
        await delay(250);
      }
      // No stray slash, and the paragraph the caret started on is untouched.
      expect(!onDisk.includes("/h1"), `the query text survived the insert:\n${onDisk}`);
      expect(onDisk.includes(PARAGRAPH), `the seeded paragraph was lost:\n${onDisk}`);
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
