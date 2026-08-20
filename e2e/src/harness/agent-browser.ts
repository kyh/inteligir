// The headless browser the browser scenarios drive, and the preamble every
// one of them owes before it can assert anything.
//
// THE ENVIRONMENT PROBE IS NOT AN ASSERTION. `about:blank` needs nothing of
// the product, so a failure there is a gap in the machine and reports SKIP
// with the exact error the CLI printed; every step a scenario takes after it —
// opening the app's own URL included — is a real assertion. That split is the
// reason this lives in the harness: it is a property of the suite, and six
// copies of it are six chances for one scenario to fail where the others skip.

import { skip } from "./assert";
import { exec, ExecError } from "./exec";

/** One scenario's browser, answering the command's trimmed stdout. */
export type AgentBrowser = (args: readonly string[], timeoutMs?: number) => Promise<string>;

/** A browser on `label`'s own agent-browser session: scenarios run in one
 *  process against one machine, so the label keeps them off each other's tabs
 *  and the pid keeps two runs of the suite apart. */
export function agentBrowserSession(label: string): AgentBrowser {
  const session = `inteligir-e2e-${label}-${process.pid}`;
  return async (args, timeoutMs = 60_000) => {
    const result = await exec("agent-browser", ["--session", session, ...args], { timeoutMs });
    return result.stdout.trim();
  };
}

/** An error with the output it captured — a CLI that failed says why on its
 *  own streams, so a reason that drops them is one nobody can act on. Local:
 *  the skip below is the only report that needs it, and an export nothing
 *  imports fails this repo's knip gate. */
function describeExecError(cause: unknown): string {
  if (cause instanceof ExecError) {
    return [cause.message, cause.stdout.trim(), cause.stderr.trim()]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return cause instanceof Error ? cause.message : String(cause);
}

/** Can a headless browser launch HERE at all? Skips the scenario if not (see
 *  the header); returns, and the caller asserts from there. */
export async function probeHeadlessOrSkip(
  browser: AgentBrowser,
  log: (message: string) => void,
): Promise<void> {
  log("probing the environment: can a headless browser launch at all?");
  try {
    await browser(["open", "about:blank"], 120_000);
  } catch (error) {
    skip(
      `agent-browser could not launch a headless browser in this environment; ` +
        `the exact error:\n${describeExecError(error)}`,
    );
  }
}
