// Drives a real headless browser over the agent-browser CLI. The invariants:
// the page loads, the SPA mounts (sidebar + editor), the virgin boot opens
// the seeded welcome note, the page reaches the API, the palette shortcut
// does not edit the note under it, and the console stays clean.
//
// The environment probe and the product assertions are SEPARATE: about:blank
// needs only the browser, so a failure there is an environment gap and
// reports SKIP with the exact error. Every step after that probe — including
// opening the app's own URL — is a real assertion.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, skip } from "../harness/assert";
import { exec, ExecError } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const SESSION = `inteligir-e2e-${process.pid}`;
const MOUNT_DEADLINE_MS = 60_000;
/** Settle window between "the page reached the API" and the error sweep, so
 *  a late-arriving async failure cannot slip in after the assertion read. */
const QUIESCENCE_MS = 1_000;
/** Longer than the note's save debounce, so a buffer edit that the palette's
 *  focus steal did not already flush has still reached disk by the read. */
const SAVE_SETTLE_MS = 2_500;
/** The palette's root query box. Prefix-matched: the placeholder ends in an
 *  ellipsis that is awkward to quote through a shell. */
const PALETTE_INPUT = 'input[placeholder^="Search notes"]';
/** agent-browser drives a browser on THIS machine, so the running platform is
 *  the one the page sees — and the app claims ⌘ there, Ctrl elsewhere. */
const PALETTE_CHORD = process.platform === "darwin" ? "Meta+k" : "Control+k";

async function agentBrowser(args: readonly string[], timeoutMs = 60_000): Promise<string> {
  const result = await exec("agent-browser", ["--session", SESSION, ...args], { timeoutMs });
  return result.stdout.trim();
}

function describeExecError(error: unknown): string {
  if (error instanceof ExecError) {
    return [error.message, error.stdout.trim(), error.stderr.trim()]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

function pageIsMounted(bodyText: string): boolean {
  // The seeded welcome note's content only reaches the page through a
  // successful /api/v1/vault/file round trip; the sidebar row proves the
  // tree query ran. Together they prove the client bundle ran against this
  // instance's API.
  return bodyText.includes("Welcome") && bodyText.includes("Welcome.md");
}

export const browserSmoke: Scenario = {
  name: "browser-smoke",
  description:
    "the page renders headless: title, SPA mount, API reached, palette chord safe, clean console",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    try {
      ctx.log("probing the environment: can a headless browser launch at all?");
      try {
        await agentBrowser(["open", "about:blank"], 120_000);
      } catch (error) {
        skip(
          `agent-browser could not launch a headless browser in this environment; ` +
            `the exact error:\n${describeExecError(error)}`,
        );
      }

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);

      ctx.log("waiting for the SPA to mount");
      await agentBrowser(["wait", "aside"], 90_000);

      ctx.log("waiting for the virgin-boot note to open in the editor");
      await agentBrowser(["wait", ".cm-content"], 90_000);

      const title = await agentBrowser(["get", "title"]);
      expect(title === "inteligir", `document title is ${JSON.stringify(title)}`);

      ctx.log("waiting for the page to reach the API");
      const deadline = Date.now() + MOUNT_DEADLINE_MS;
      for (;;) {
        const body = await agentBrowser(["get", "text", "body"]);
        if (pageIsMounted(body)) {
          break;
        }
        expect(
          Date.now() < deadline,
          `the SPA never reached the API; body text:\n${body.slice(0, 2_000)}`,
        );
        await delay(500);
      }

      // The regression this pins: the editor's keymap ALSO bound the palette
      // chord, so the palette opened over a note that had just had `[]()`
      // spliced into it. Disk is the oracle rather than the rendered text —
      // decorations move with the caret, bytes do not — and the palette
      // stealing focus flushes the editor, so a corrupted buffer WOULD land.
      ctx.log("the palette chord opens the palette without editing the note under it");
      const welcomeFile = join(app.vaultDir, "Welcome.md");
      const beforeChord = await readFile(welcomeFile, "utf8");
      await agentBrowser(["click", ".cm-content"]);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["press", PALETTE_CHORD]);
      await agentBrowser(["wait", PALETTE_INPUT], 30_000);
      await agentBrowser(["press", "Escape"]);
      await delay(SAVE_SETTLE_MS);
      const afterChord = await readFile(welcomeFile, "utf8");
      expect(
        afterChord === beforeChord,
        `${PALETTE_CHORD} changed Welcome.md on disk:\n${JSON.stringify(afterChord)}`,
      );

      ctx.log("settling, then sweeping for page and console errors");
      await delay(QUIESCENCE_MS);
      const settledBody = await agentBrowser(["get", "text", "body"]);
      expect(pageIsMounted(settledBody), "the page stays mounted through the settle window");

      const pageErrors = await agentBrowser(["errors"]);
      expect(
        pageErrors.length === 0 || /^no /iu.test(pageErrors),
        `page errors were raised:\n${pageErrors}`,
      );
      const consoleOutput = await agentBrowser(["console"]);
      const errorLines = consoleOutput
        .split("\n")
        .filter((line) => /^\s*\[?err(or)?\]?\b/iu.test(line));
      expect(errorLines.length === 0, `console errors were logged:\n${errorLines.join("\n")}`);
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
