import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { modChord, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, OPTION_COUNT, PALETTE_INPUT } from "../harness/selectors";

// sort A1 before A2, so the virgin boot opens the first and the rows come in this order.
const NOTE_ONE = "A1 zebrafish.md";
const NOTE_TWO = "A2 zebrafish.md";
const NEEDLE = "zebrafish";
const DOC_ONE = "# One\n\nThe zebrafish swims.\n";
const DOC_TWO = "# Two\n\nAnother zebrafish here, and a zebrafish there.\n";
const SEARCH_INPUT = 'input[placeholder^="Search across the vault"]';
const FIND_BAR_INPUT = 'input[aria-label="Find in note"]';
const ROWS_DEADLINE_MS = 20_000;

const waitForRows = async (
  agentBrowser: AgentBrowser,
  expected: number,
  what: string,
): Promise<void> => {
  await pollUntil(
    async () => parseEval(await agentBrowser(["eval", OPTION_COUNT]), z.string()),
    (count) => count === String(expected),
    {
      deadlineMs: ROWS_DEADLINE_MS,
      describe: (count) => `${what}: expected ${String(expected)} rows, saw ${count}`,
    },
  );
};

// the palette is the one search surface: its root row opens the vault-wide scan
const openSearch = async (agentBrowser: AgentBrowser): Promise<void> => {
  await agentBrowser(["click", EDITOR]);
  await agentBrowser(["press", modChord("p")]);
  await agentBrowser(["wait", PALETTE_INPUT], 30_000);
  await agentBrowser(["find", "role", "option", "click", "--name", "Search across the vault…"]);
  await agentBrowser(["wait", SEARCH_INPUT], 30_000);
  await agentBrowser(["fill", SEARCH_INPUT, NEEDLE]);
  // one row per occurrence: one in the first note, two in the second
  await waitForRows(agentBrowser, 3, "the search page");
};

export const vaultSearchBrowser: Scenario = {
  description: "the palette's vault search lists every match; Enter lands the find bar on one",
  name: "vault-search-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, NOTE_ONE), DOC_ONE, "utf-8");
        await writeFile(path.join(vaultDir, NOTE_TWO), DOC_TWO, "utf-8");
      },
    });
    const agentBrowser = await ctx.browser("vault-search");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);

    ctx.log("the palette opens the search page and the rows arrive");
    await openSearch(agentBrowser);

    ctx.log("the second row is the other note's first match; Enter opens it on the find bar");
    await agentBrowser(["press", "ArrowDown"]);
    await agentBrowser(["press", "Enter"]);
    await pollUntil(
      async () => ({
        // the editor remounts on the note switch; a read in that gap finds no element
        body: parseEval(
          await agentBrowser([
            "eval",
            `String(document.querySelector('${EDITOR}')?.textContent ?? "")`,
          ]),
          z.string(),
        ),
        value: parseEval(
          await agentBrowser([
            "eval",
            `String(document.querySelector('${FIND_BAR_INPUT}')?.value ?? "")`,
          ]),
          z.string(),
        ),
      }),
      (landed) => landed.value === NEEDLE && landed.body.includes("Another zebrafish"),
      {
        deadlineMs: ROWS_DEADLINE_MS,
        describe: (landed) =>
          `the pick never landed: find bar holds ${JSON.stringify(landed.value)}, editor shows:\n${landed.body.slice(0, 300)}`,
      },
    );
  },
};
