import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { modChord, parseEval, untilBodyHolds } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const NOTE = "Heron notes.md";
const PASSAGE = "Herons stand still for a long time before they strike.";
const DOC = `---\nid: 4f3e2d1c-0b9a-4876-9543-210fedcba987\nsaved: 2026-10-01T09:00:00Z\n---\n# Heron notes\n\n${PASSAGE}\n\nThe second paragraph stays plain.\n`;
const NOTE_TEXT = "Worth a second read";
const NOTE_FIELD = 'textarea[aria-label="Note"]';
const DEADLINE_MS = 30_000;
const MARKERS = /%%i:(?<id>[a-z0-9]+):start%%(?<words>[^%]+)%%i:\k<id>:end%%/u;

const TINTED = `String(document.querySelectorAll('${EDITOR} [data-slate-leaf] .bg-highlight, ${EDITOR} .bg-highlight').length)`;

export const annotationsBrowser: Scenario = {
  description:
    "select, ⌘⇧H, the highlight's tint, a note saved, and its card in the Annotations tab",
  name: "annotations-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, NOTE), DOC, "utf-8");
      },
    });
    const browser = await ctx.browser("annotations");
    await browser.openWorkspace(app, {
      path: `/?item=${encodeURIComponent(NOTE)}`,
      ready: EDITOR,
    });

    ctx.log("selecting the passage with the mouse, as a reader does");
    const box = parseEval(
      await browser([
        "eval",
        `JSON.stringify((() => { const el = [...document.querySelectorAll('${EDITOR} p')].find((p) => p.textContent === ${JSON.stringify(PASSAGE)}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2), right: Math.round(r.right) }; })())`,
      ]),
      z.object({ right: z.number(), x: z.number(), y: z.number() }),
    );
    await browser(["mouse", "move", String(box.x + 1), String(box.y)]);
    await browser(["mouse", "down"]);
    await browser(["mouse", "move", String(box.x + 40), String(box.y)]);
    await browser(["mouse", "move", String(box.right - 1), String(box.y)]);
    await browser(["mouse", "up"]);
    await pollUntil(
      async () => parseEval(await browser(["eval", "String(window.getSelection())"]), z.string()),
      (selected) => selected.length > 10,
      { deadlineMs: DEADLINE_MS, describe: (selected) => `nothing selected: "${selected}"` },
    );

    ctx.log("⌘⇧H makes the highlight at once, with the passage it quotes, and offers a note");
    await browser(["press", modChord("Shift+h")]);
    const marked = await pollUntil(
      async () => await readFile(path.join(app.vaultDir, NOTE), "utf-8"),
      (text) => MARKERS.test(text),
      { deadlineMs: DEADLINE_MS, describe: (text) => `no markers reached the file:\n${text}` },
    );
    const id = MARKERS.exec(marked)?.groups?.id ?? "";
    const bare = await pollUntil(
      async () => await app.api.annotations.list({ path: NOTE }),
      (listed) => listed.annotations.some((annotation) => annotation.id === id),
      { deadlineMs: DEADLINE_MS, describe: () => `the highlight ${id} has no entry` },
    );
    const entry = bare.annotations.find((annotation) => annotation.id === id);
    expectEq(entry?.root.text, "", "a highlight's note before one is written");
    expect(
      entry?.quote?.includes("Herons stand still") === true,
      `the entry does not quote the passage: ${String(entry?.quote)}`,
    );

    ctx.log("the highlight is tinted");
    await pollUntil(
      async () => parseEval(await browser(["eval", TINTED]), z.string()),
      (count) => count !== "0",
      { deadlineMs: DEADLINE_MS, describe: () => "the highlighted words were never tinted" },
    );

    ctx.log("a note typed in the popover is saved on Return");
    await browser(["wait", NOTE_FIELD], DEADLINE_MS);
    await browser(["fill", NOTE_FIELD, NOTE_TEXT]);
    await browser(["press", "Enter"]);
    await pollUntil(
      async () => await app.api.annotations.list({ path: NOTE }),
      (listed) =>
        listed.annotations.some(
          (annotation) => annotation.id === id && annotation.root.text === NOTE_TEXT,
        ),
      { deadlineMs: DEADLINE_MS, describe: () => "the note never reached the highlight's entry" },
    );

    ctx.log("the Annotations tab holds its card, the words and the note");
    await browser(["click", 'button[aria-label^="Annotations"]']);
    await browser(["wait", `[data-annotation-id="${id}"]`], DEADLINE_MS);
    await untilBodyHolds(browser, [NOTE_TEXT, "Remove highlight"]);
  },
};
