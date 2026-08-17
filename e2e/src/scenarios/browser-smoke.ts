// Drives a real headless browser over the agent-browser CLI. The invariants:
// the page loads, the SPA mounts (sidebar + editor), the virgin boot opens
// the seeded welcome note, the page reaches the API, and the console stays
// clean.
//
// The environment probe and the product assertions are SEPARATE: about:blank
// needs only the browser, so a failure there is an environment gap and
// reports SKIP with the exact error. Every step after that probe — including
// opening the app's own URL — is a real assertion.

import { setTimeout as delay } from "node:timers/promises";
import { expect, skip } from "../harness/assert";
import { exec, ExecError } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const SESSION = `inteligir-e2e-${process.pid}`;
const MOUNT_DEADLINE_MS = 60_000;
/** Settle window between "the page reached the API" and the error sweep, so
 *  a late-arriving async failure cannot slip in after the assertion read. */
const QUIESCENCE_MS = 1_000;

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
  description: "the page renders headless: title, SPA mount, API reached, clean console",
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
