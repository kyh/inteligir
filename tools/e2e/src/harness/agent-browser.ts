import { z } from "zod";
import { skip } from "./assert";
import { describeExecError, exec } from "./exec";
import type { AppInstance } from "./instance";
import { EDITOR, SIDEBAR } from "./selectors";

export type AgentBrowser = (args: readonly string[], timeoutMs?: number) => Promise<string>;

interface OpenWorkspaceOptions {
  path?: string;
  // chrome flags; they take effect only on the command that launches this session's browser.
  launchArgs?: readonly string[];
}

interface ScenarioBrowserControls {
  // signs the browser in through a fresh handoff and returns once the rail and the editor mounted.
  openWorkspace: (app: AppInstance, options?: OpenWorkspaceOptions) => Promise<void>;
  close: () => Promise<void>;
}

export type ScenarioBrowser = AgentBrowser & ScenarioBrowserControls;

const agentBrowserSession = (label: string): AgentBrowser => {
  // label keeps scenarios off each other's tabs; pid keeps two runs of the suite apart.
  const session = `inteligir-e2e-${label}-${process.pid}`;
  return async (args, timeoutMs = 60_000) => {
    const result = await exec("agent-browser", ["--session", session, ...args], { timeoutMs });
    return result.stdout.trim();
  };
};

// agent-browser drives a browser on this machine, so the page reads this platform's modifier.
export const modChord = (key: string): string =>
  `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;

// agent-browser eval answers a JSON-encoded string; an object payload is a second JSON layer in it.
export const parseEval = <T>(raw: string, schema: z.ZodType<T>): T => {
  const text = z.string().parse(JSON.parse(raw));
  return schema.parse(/^[{[]/u.test(text) ? JSON.parse(text) : text);
};

// teardown: a session that already died must not mask the failure the scenario is reporting.
const closeQuietly = async (browser: AgentBrowser): Promise<void> => {
  try {
    await browser(["close"], 30_000);
  } catch {
    // the browser is gone either way.
  }
};

// about:blank needs nothing of the product, so a failure here is an environment gap (skip), not an
// assertion; a run whose environment was provisioned passes --no-skip, and the runner fails it.
const probeHeadlessOrSkip = async (log: (message: string) => void): Promise<void> => {
  const probe = agentBrowserSession("probe");
  log("probing the environment: can a headless browser launch at all?");
  try {
    await probe(["open", "about:blank"], 120_000);
  } catch (error) {
    skip(
      `agent-browser could not launch a headless browser in this environment; ` +
        `the exact error:\n${describeExecError(error)}`,
    );
  } finally {
    await closeQuietly(probe);
  }
};

// once per run, because whether a browser launches is the machine's answer; in a session of its
// own, because a scenario's session must launch with that scenario's own flags.
let probed: Promise<void> | null = null;

export const requireHeadlessBrowser = async (log: (message: string) => void): Promise<void> => {
  probed ??= probeHeadlessOrSkip(log);
  await probed;
};

export const createScenarioBrowser = (label: string): ScenarioBrowser => {
  const run = agentBrowserSession(label);
  const controls: ScenarioBrowserControls = {
    close: async () => {
      await closeQuietly(run);
    },
    openWorkspace: async (app, options = {}) => {
      const url = await app.browserUrl(options.path ?? "/");
      const launch =
        options.launchArgs === undefined ? [] : ["--args", options.launchArgs.join(",")];
      await run([...launch, "open", url], 60_000);
      await run(["wait", SIDEBAR], 90_000);
      await run(["wait", EDITOR], 90_000);
    },
  };
  return Object.assign(run, controls);
};
