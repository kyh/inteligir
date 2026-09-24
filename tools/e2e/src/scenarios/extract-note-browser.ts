import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseEval } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

// sorts before the seeded notes, so the virgin boot opens it.
const NOTE = "Aardvark plan.md";
const FIRST = "First paragraph.";
const SECOND = "Second paragraph.";
const DOC = `# Plan\n\n${FIRST}\n\n${SECOND}\n`;
// the first line names the note, its trailing dot trimmed
const EXTRACTED = "Second paragraph.md";
const DISK_DEADLINE_MS = 30_000;
const TOOLBAR_DEADLINE_MS = 10_000;

export const extractNoteBrowser: Scenario = {
  description: "the selection toolbar extracts the selected block to a new note and leaves a link",
  name: "extract-note-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, NOTE), DOC, "utf-8");
      },
    });
    const agentBrowser = await ctx.browser("extract");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);

    ctx.log("selecting the second paragraph with the mouse, which raises the toolbar");
    // a drag across the text, as a user selects: a key chord lands nowhere until the editor
    // has taken focus, and the toolbar opens on a pointer-made selection either way
    const box = parseEval(
      await agentBrowser([
        "eval",
        `JSON.stringify((() => { const el = [...document.querySelectorAll('${EDITOR} p')].find((p) => p.textContent === ${JSON.stringify(SECOND)}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2), right: Math.round(r.right) }; })())`,
      ]),
      z.object({ right: z.number(), x: z.number(), y: z.number() }),
    );
    await agentBrowser(["mouse", "move", String(box.x + 1), String(box.y)]);
    await agentBrowser(["mouse", "down"]);
    await agentBrowser(["mouse", "move", String(box.x + 40), String(box.y)]);
    await agentBrowser(["mouse", "move", String(box.right - 1), String(box.y)]);
    await agentBrowser(["mouse", "up"]);
    // the toolbar floats in after the selection settles; the failure names what the page holds
    await pollUntil(
      async () =>
        parseEval(
          await agentBrowser([
            "eval",
            `JSON.stringify({ selected: String(window.getSelection()), button: document.querySelectorAll('button[aria-label="Extract to new note"]').length })`,
          ]),
          z.object({ button: z.number(), selected: z.string() }),
        ),
      (state) => state.button > 0,
      {
        deadlineMs: TOOLBAR_DEADLINE_MS,
        describe: (state) =>
          `the selection toolbar never offered Extract; selection: ${JSON.stringify(state.selected)}`,
      },
    );
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
    const landed = await pollUntil(
      async () => ({
        extracted: await readFile(path.join(app.vaultDir, EXTRACTED), "utf-8").catch(() => null),
        source: await readFile(path.join(app.vaultDir, NOTE), "utf-8"),
      }),
      (notes) => notes.extracted !== null && notes.source.includes("[[Second paragraph]]"),
      {
        deadlineMs: DISK_DEADLINE_MS,
        describe: (notes) =>
          `the extract never landed: ${EXTRACTED} ${notes.extracted === null ? "absent" : "present"}; source:\n${notes.source}`,
      },
    );
    expect(
      landed.extracted === `${SECOND}\n`,
      `the extracted note is not the block:\n${String(landed.extracted)}`,
    );
    expect(landed.source.includes(FIRST), `the first paragraph was lost:\n${landed.source}`);
    expect(!landed.source.includes(SECOND), `the extracted block stayed behind:\n${landed.source}`);
  },
};
