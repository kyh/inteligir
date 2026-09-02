import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { agentBrowserSession, parseEval, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("editor");
const DOC_PATH = "Constructs.md";
const EDITOR = '[data-slate-editor="true"]';

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
`;

const PROBE = `JSON.stringify({
  bold: !!document.querySelector('${EDITOR} strong, ${EDITOR} b'),
  blockquotes: document.querySelectorAll('${EDITOR} blockquote').length,
  checkboxes: document.querySelectorAll('${EDITOR} input[type=checkbox], ${EDITOR} [role=checkbox]').length,
  fence: !!document.querySelector('${EDITOR} pre'),
  table: !!document.querySelector('${EDITOR} table'),
})`;

const probeSchema = z
  .object({
    bold: z.boolean(),
    blockquotes: z.number(),
    checkboxes: z.number(),
    fence: z.boolean(),
    table: z.boolean(),
  })
  .strict();

export const editorConstructsBrowser: Scenario = {
  name: "editor-constructs-browser",
  description: "seeded constructs render as their elements, and rendering writes nothing",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      // sorts before the seeded welcome note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, DOC_PATH), DOC, "utf8");
      },
    });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);
      await agentBrowser(["wait", `${EDITOR} table`], 30_000);

      ctx.log("probing the rendered constructs");
      const probe = parseEval(await agentBrowser(["eval", PROBE]), probeSchema);
      expect(probe.bold, "bold text did not render as <strong>");
      // the callout and the ordinary quote both render as blockquotes.
      expect(probe.blockquotes >= 2, `expected 2 blockquotes, got ${probe.blockquotes}`);
      expect(probe.checkboxes >= 2, `expected the 2 task checkboxes, got ${probe.checkboxes}`);
      expect(probe.fence, "the code fence did not render as <pre>");
      expect(probe.table, "the table did not render as <table>");

      ctx.log("rendering wrote nothing: the seeded bytes are untouched");
      await delay(2_500);
      const onDisk = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
      expectEq(onDisk, DOC, "opening the note changed its bytes");

      ctx.log("an edit keeps every construct on disk");
      // the bottom toolbar floats over the note's lower half, so a text-target click can land under
      // it.
      await agentBrowser(["click", EDITOR]);
      await agentBrowser(["press", "Meta+Home"]);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["type", EDITOR, " Edited."]);
      const deadline = Date.now() + 15_000;
      for (;;) {
        const after = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
        if (after.includes("Edited.")) {
          for (const marker of [
            "**bold**",
            "`inline code`",
            "> [!WARNING]",
            "- [ ]",
            "```ts",
            "| Name |",
          ]) {
            expect(after.includes(marker), `${marker} was lost by the save:\n${after}`);
          }
          break;
        }
        expect(Date.now() < deadline, `the edit never saved:\n${after}`);
        await delay(250);
      }
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
