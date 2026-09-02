import { z } from "zod";
import { skip } from "./assert";
import { exec, ExecError } from "./exec";

export type AgentBrowser = (args: readonly string[], timeoutMs?: number) => Promise<string>;

export function agentBrowserSession(label: string): AgentBrowser {
  // label keeps scenarios off each other's tabs; pid keeps two runs of the suite apart.
  const session = `inteligir-e2e-${label}-${process.pid}`;
  return async (args, timeoutMs = 60_000) => {
    const result = await exec("agent-browser", ["--session", session, ...args], { timeoutMs });
    return result.stdout.trim();
  };
}

// agent-browser eval answers a JSON-encoded string; an object payload is a second JSON layer in it.
export function parseEval<T>(raw: string, schema: z.ZodType<T>): T {
  const text = z.string().parse(JSON.parse(raw));
  return schema.parse(/^[{[]/u.test(text) ? JSON.parse(text) : text);
}

function describeExecError(cause: unknown): string {
  if (cause instanceof ExecError) {
    return [cause.message, cause.stdout.trim(), cause.stderr.trim()]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return cause instanceof Error ? cause.message : String(cause);
}

// about:blank needs nothing of the product, so a failure here is an environment gap (skip), not an
// assertion.
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
