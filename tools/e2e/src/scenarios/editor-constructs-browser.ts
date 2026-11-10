import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { modChord, parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const TITLE = "Constructs";

const DOC = `# Constructs

Prose with **bold** and \`inline code\`.

> [!WARNING]
> Mind the gap.

> An ordinary quote, which is not a callout.

- [ ] an open task
- [x] a done task

\`\`\`ts
const x = 1;
\`\`\`

| Name | Right |
| ---- | ----- |
| a    | 1     |

\`\`\`mermaid
graph TD;
A[Draft]-->B[Review];
\`\`\`
`;

// Pele's own class on the drawing it answers
const DIAGRAM = `${EDITOR} svg.pele`;

const PROBE = `JSON.stringify({
  bold: !!document.querySelector('${EDITOR} strong, ${EDITOR} b'),
  blockquotes: document.querySelectorAll('${EDITOR} blockquote').length,
  checkboxes: document.querySelectorAll('${EDITOR} input[type=checkbox], ${EDITOR} [role=checkbox]').length,
  fence: !!document.querySelector('${EDITOR} pre'),
  table: !!document.querySelector('${EDITOR} table'),
})`;

const probeSchema = z.strictObject({
  blockquotes: z.number(),
  bold: z.boolean(),
  checkboxes: z.number(),
  fence: z.boolean(),
  table: z.boolean(),
});

// the flip and both reads run in one task, so no script (the editor's, React's, Pele's) can run
// between them: a fill that changes is the stylesheet's doing alone
const THEME_FLIP = `(() => {
  const svg = document.querySelector('${DIAGRAM}');
  const node = svg?.querySelector('rect');
  if (!svg || !node) return JSON.stringify(null);
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  const before = getComputedStyle(node).fill;
  root.classList.toggle('dark');
  const after = getComputedStyle(node).fill;
  root.classList.toggle('dark', wasDark);
  return JSON.stringify({ after, before, labels: [...svg.querySelectorAll('text')].map((text) => text.textContent) });
})()`;

const themeFlipSchema = z
  .strictObject({ after: z.string(), before: z.string(), labels: z.array(z.string()) })
  .nullable();

export const editorConstructsBrowser: Scenario = {
  description:
    "every live-preview construct renders in a real browser tab under the page's policy (jsdom has no layout, so the unit suite cannot prove a widget survived the bundle and a measure pass), opening the item writes nothing to the cell, and an edit keeps every construct in the item's markdown",
  name: "editor-constructs-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    ctx.log("opening the item by its deep link");
    const {
      browser,
      library,
      seeded: { itemId, seq },
    } = await openLibraryTab(
      ctx,
      "editor",
      async (seeding) => {
        const { item } = await seeding.items.createNote({ markdown: DOC, title: TITLE });
        const row = await seeding.items.row({ id: item.id });
        return { itemId: item.id, seq: row.seq };
      },
      {
        path: (seeded) => `?item=${seeded.itemId}`,
        ready: EDITOR,
      },
    );
    await browser(["wait", `${EDITOR} table`], 30_000);

    ctx.log("probing the rendered constructs");
    const probe = parseEval(await browser(["eval", PROBE]), probeSchema);
    expect(probe.bold, "bold text did not render as <strong>");
    // the callout and the ordinary quote both render as blockquotes.
    expect(probe.blockquotes >= 2, `expected 2 blockquotes, got ${String(probe.blockquotes)}`);
    expect(
      probe.checkboxes >= 2,
      `expected the 2 task checkboxes, got ${String(probe.checkboxes)}`,
    );
    expect(probe.fence, "the code fence did not render as <pre>");
    expect(probe.table, "the table did not render as <table>");

    ctx.log(
      "the mermaid fence draws under the served policy, and the theme recolours it with no redraw",
    );
    await browser(["wait", DIAGRAM], 30_000);
    const flip = parseEval(await browser(["eval", THEME_FLIP]), themeFlipSchema);
    if (flip === null) {
      throw new Error("the diagram drew no shape to read a fill from");
    }
    expect(
      flip.labels.includes("Draft") && flip.labels.includes("Review"),
      `the diagram's labels are ${JSON.stringify(flip.labels)}`,
    );
    expect(
      flip.before !== flip.after,
      `a node's fill stayed ${flip.before} across the theme flip: the frame's --pele-* tokens did not reach the drawing`,
    );

    ctx.log("rendering wrote nothing: the item's sequence is the one it was seeded at");
    // past the note's debounced save
    await delay(2500);
    const opened = await library.items.row({ id: itemId });
    expectEq(opened.seq, seq, "opening the item wrote to it");

    ctx.log("an edit keeps every construct in the item");
    await browser(["click", `${EDITOR} h1`]);
    await browser(["press", modChord("Home")]);
    await browser(["press", "End"]);
    await browser(["keyboard", "type", " Edited."]);
    const after = await untilItemText(
      library,
      itemId,
      (markdown) => markdown.includes("Edited."),
      "the edit never reached the cell",
    );
    for (const marker of [
      "**bold**",
      "`inline code`",
      "> [!WARNING]",
      "- [ ]",
      "```ts",
      "| Name |",
      "```mermaid",
    ]) {
      expect(after.includes(marker), `${marker} was lost by the save:\n${after}`);
    }
  },
};
