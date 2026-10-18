import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { modChord, parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const DOC_PATH = "Constructs.md";

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
    "every live-preview construct renders in a real browser (jsdom has no layout, so the unit suite cannot prove a widget survived the bundle and a measure pass), the file is re-read to prove rendering wrote no bytes, and an edit keeps every construct on disk",
  name: "editor-constructs-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, DOC_PATH), DOC, "utf-8");
      },
    });

    const agentBrowser = await ctx.browser("editor");

    ctx.log(`opening ${DOC_PATH} by its deep link`);
    await agentBrowser.openWorkspace(app, {
      path: `/?item=${encodeURIComponent(DOC_PATH)}`,
      ready: EDITOR,
    });
    await agentBrowser(["wait", `${EDITOR} table`], 30_000);

    ctx.log("probing the rendered constructs");
    const probe = parseEval(await agentBrowser(["eval", PROBE]), probeSchema);
    expect(probe.bold, "bold text did not render as <strong>");
    // the callout and the ordinary quote both render as blockquotes.
    expect(probe.blockquotes >= 2, `expected 2 blockquotes, got ${probe.blockquotes}`);
    expect(probe.checkboxes >= 2, `expected the 2 task checkboxes, got ${probe.checkboxes}`);
    expect(probe.fence, "the code fence did not render as <pre>");
    expect(probe.table, "the table did not render as <table>");

    ctx.log(
      "the mermaid fence draws under the served CSP, and the theme recolours it with no redraw",
    );
    await agentBrowser(["wait", DIAGRAM], 30_000);
    const flip = parseEval(await agentBrowser(["eval", THEME_FLIP]), themeFlipSchema);
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

    ctx.log("rendering wrote nothing: the seeded bytes are untouched");
    await delay(2500);
    const onDisk = await readFile(path.join(app.vaultDir, DOC_PATH), "utf-8");
    expectEq(onDisk, DOC, "opening the note changed its bytes");

    ctx.log("an edit keeps every construct on disk");
    // the bottom toolbar floats over the note's lower half, so a text-target click can land under
    // it.
    await agentBrowser(["click", EDITOR]);
    await agentBrowser(["press", modChord("Home")]);
    await agentBrowser(["press", "End"]);
    await agentBrowser(["type", EDITOR, " Edited."]);
    const after = await pollUntil(
      async () => await readFile(path.join(app.vaultDir, DOC_PATH), "utf-8"),
      (bytes) => bytes.includes("Edited."),
      { deadlineMs: 15_000, describe: (bytes) => `the edit never saved:\n${bytes}` },
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
