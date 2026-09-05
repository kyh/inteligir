import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { agentBrowserSession, parseEval, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("extract");
// sorts before the seeded notes, so the virgin boot opens it.
const NOTE = "Aardvark plan.md";
const FIRST = "First paragraph.";
const SECOND = "Second paragraph.";
const DOC = `# Plan\n\n${FIRST}\n\n${SECOND}\n`;
// the first line names the note, its trailing dot trimmed
const EXTRACTED = "Second paragraph.md";
const EDITOR = '[data-slate-editor="true"]';
const DISK_DEADLINE_MS = 30_000;
const TOOLBAR_DEADLINE_MS = 10_000;

export const extractNoteBrowser: Scenario = {
  name: "extract-note-browser",
  description: "the selection toolbar extracts the selected block to a new note and leaves a link",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, NOTE), DOC, "utf8");
      },
    });
    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);

      ctx.log("selecting the second paragraph with the mouse, which raises the toolbar");
      // a drag across the text, as a user selects: a key chord lands nowhere until the editor
      // has taken focus, and the toolbar opens on a pointer-made selection either way
      const box = parseEval(
        await agentBrowser([
          "eval",
          `JSON.stringify((() => { const el = [...document.querySelectorAll('${EDITOR} p')].find((p) => p.textContent === ${JSON.stringify(SECOND)}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2), right: Math.round(r.right) }; })())`,
        ]),
        z.object({ x: z.number(), y: z.number(), right: z.number() }),
      );
      await agentBrowser(["mouse", "move", String(box.x + 1), String(box.y)]);
      await agentBrowser(["mouse", "down"]);
      await agentBrowser(["mouse", "move", String(box.x + 40), String(box.y)]);
      await agentBrowser(["mouse", "move", String(box.right - 1), String(box.y)]);
      await agentBrowser(["mouse", "up"]);
      // the toolbar floats in after the selection settles; the failure names what the page holds
      const toolbarDeadline = Date.now() + TOOLBAR_DEADLINE_MS;
      for (;;) {
        const state = parseEval(
          await agentBrowser([
            "eval",
            `JSON.stringify({ selected: String(window.getSelection()), button: document.querySelectorAll('button[aria-label="Extract to new note"]').length })`,
          ]),
          z.object({ selected: z.string(), button: z.number() }),
        );
        if (state.button > 0) {
          break;
        }
        expect(
          Date.now() < toolbarDeadline,
          `the selection toolbar never offered Extract; selection: ${JSON.stringify(state.selected)}`,
        );
        await delay(250);
      }
      await agentBrowser([
        "find",
        "role",
        "button",
        "click",
        "--name",
        "Extract to new note",
        "--exact",
      ]);

      ctx.log("the new note holds the block's bytes and the old note links to it");
      const deadline = Date.now() + DISK_DEADLINE_MS;
      for (;;) {
        const extracted = await readFile(join(app.vaultDir, EXTRACTED), "utf8").catch(() => null);
        const source = await readFile(join(app.vaultDir, NOTE), "utf8");
        if (extracted !== null && source.includes("[[Second paragraph]]")) {
          expect(extracted === `${SECOND}\n`, `the extracted note is not the block:\n${extracted}`);
          expect(source.includes(FIRST), `the first paragraph was lost:\n${source}`);
          expect(!source.includes(SECOND), `the extracted block stayed behind:\n${source}`);
          break;
        }
        expect(
          Date.now() < deadline,
          `the extract never landed: ${EXTRACTED} ${extracted === null ? "absent" : "present"}; source:\n${source}`,
        );
        await delay(250);
      }
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
