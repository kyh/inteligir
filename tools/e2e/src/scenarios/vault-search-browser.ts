import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { agentBrowserSession, parseEval, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("vault-search");
// sort before the seeded notes, so the virgin boot opens the first and the rows come in this order.
const NOTE_ONE = "A1 zebrafish.md";
const NOTE_TWO = "A2 zebrafish.md";
const NEEDLE = "zebrafish";
const REPLACEMENT = "goldfish";
const DOC_ONE = "# One\n\nThe zebrafish swims.\n";
const DOC_TWO = "# Two\n\nAnother zebrafish here, and a zebrafish there.\n";
const EDITOR = '[data-slate-editor="true"]';
const SEARCH_INPUT = 'input[placeholder^="Search across the vault"]';
const REPLACE_INPUT = 'input[aria-label="Replace with"]';
const FIND_BAR_INPUT = 'input[aria-label="Find in note"]';
// agent-browser drives a browser on this machine, so the page sees this platform's modifier.
const SEARCH_CHORD = process.platform === "darwin" ? "Meta+Shift+f" : "Control+Shift+f";
const ROWS_DEADLINE_MS = 20_000;
const DISK_DEADLINE_MS = 30_000;
const OPTION_COUNT = "String(document.querySelectorAll('[role=option]').length)";

async function waitForRows(expected: number, what: string): Promise<void> {
  const deadline = Date.now() + ROWS_DEADLINE_MS;
  for (;;) {
    const count = parseEval(await agentBrowser(["eval", OPTION_COUNT]), z.string());
    if (count === String(expected)) {
      return;
    }
    expect(Date.now() < deadline, `${what}: expected ${String(expected)} rows, saw ${count}`);
    await delay(250);
  }
}

async function openSearch(): Promise<void> {
  await agentBrowser(["click", EDITOR]);
  await agentBrowser(["press", SEARCH_CHORD]);
  await agentBrowser(["wait", SEARCH_INPUT], 30_000);
  await agentBrowser(["fill", SEARCH_INPUT, NEEDLE]);
  // one row per occurrence: one in the first note, two in the second
  await waitForRows(3, "the search page");
}

export const vaultSearchBrowser: Scenario = {
  name: "vault-search-browser",
  description:
    "⌘⇧F lists every match; Enter lands the find bar on one; Replace all rewrites the notes on disk",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, NOTE_ONE), DOC_ONE, "utf8");
        await writeFile(join(vaultDir, NOTE_TWO), DOC_TWO, "utf8");
      },
    });
    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);

      ctx.log("the chord opens the search page and the rows arrive");
      await openSearch();

      ctx.log("the second row is the other note's first match; Enter opens it on the find bar");
      await agentBrowser(["press", "ArrowDown"]);
      await agentBrowser(["press", "Enter"]);
      const findDeadline = Date.now() + ROWS_DEADLINE_MS;
      for (;;) {
        const value = parseEval(
          await agentBrowser([
            "eval",
            `String(document.querySelector('${FIND_BAR_INPUT}')?.value ?? "")`,
          ]),
          z.string(),
        );
        // the editor remounts on the note switch; a read in that gap finds no element
        const body = parseEval(
          await agentBrowser([
            "eval",
            `String(document.querySelector('${EDITOR}')?.textContent ?? "")`,
          ]),
          z.string(),
        );
        if (value === NEEDLE && body.includes("Another zebrafish")) {
          break;
        }
        expect(
          Date.now() < findDeadline,
          `the pick never landed: find bar holds ${JSON.stringify(value)}, editor shows:\n${body.slice(0, 300)}`,
        );
        await delay(250);
      }
      await agentBrowser(["press", "Escape"]);

      ctx.log("Replace all over both notes, through the confirm");
      await openSearch();
      await agentBrowser(["fill", REPLACE_INPUT, REPLACEMENT]);
      await agentBrowser(["find", "role", "button", "click", "--name", "Replace all", "--exact"]);
      // the palette closes first, then the confirm asks with the same verb
      await agentBrowser(["find", "role", "button", "click", "--name", "Replace all", "--exact"]);

      const diskDeadline = Date.now() + DISK_DEADLINE_MS;
      for (;;) {
        const one = await readFile(join(app.vaultDir, NOTE_ONE), "utf8");
        const two = await readFile(join(app.vaultDir, NOTE_TWO), "utf8");
        if (!one.includes(NEEDLE) && !two.includes(NEEDLE)) {
          expect(
            one === DOC_ONE.replaceAll(NEEDLE, REPLACEMENT),
            `${NOTE_ONE} was rewritten beyond the match:\n${one}`,
          );
          expect(
            two === DOC_TWO.replaceAll(NEEDLE, REPLACEMENT),
            `${NOTE_TWO} was rewritten beyond the matches:\n${two}`,
          );
          break;
        }
        expect(Date.now() < diskDeadline, `the replace never reached disk:\n${one}\n---\n${two}`);
        await delay(250);
      }
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
