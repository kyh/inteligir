import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { skip } from "./assert";
import { describeExecError, exec } from "./exec";
import type { AppInstance } from "./instance";
import { pollUntil } from "./poll";
import { LIBRARY_GRID, SIDEBAR } from "./selectors";

export type AgentBrowser = (args: readonly string[], timeoutMs?: number) => Promise<string>;

interface OpenWorkspaceOptions {
  path?: string;
  // what the page shows once it is ready: the library's grid, which the window opens on, unless
  // the path opened an item (`/?item=…`), whose caller names the editor or its viewer instead
  ready?: string;
}

interface ScenarioBrowserControls {
  // signs the browser in through a fresh handoff and returns once the rail and `ready` mounted.
  openWorkspace: (app: AppInstance, options?: OpenWorkspaceOptions) => Promise<void>;
  close: () => Promise<void>;
}

export type ScenarioBrowser = AgentBrowser & ScenarioBrowserControls;

// launchFlags ride every call, after --session: agent-browser launches its browser on whichever
// call comes first, so a flag only the first call carried would launch nothing once a later one did.
const agentBrowserSession = (label: string, launchFlags: readonly string[] = []): AgentBrowser => {
  // label keeps scenarios off each other's tabs; pid keeps two runs of the suite apart.
  const session = `inteligir-e2e-${label}-${process.pid}`;
  return async (args, timeoutMs = 60_000) => {
    const result = await exec("agent-browser", ["--session", session, ...launchFlags, ...args], {
      timeoutMs,
    });
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

// by exact text inside one scope: a covered workspace may still hold a button of the same name.
const pressButtonIn = (scope: string, name: string): string => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)});
  const button = root ? [...root.querySelectorAll("button")].find((el) => el.textContent.trim() === ${JSON.stringify(name)}) : null;
  if (!button) return "missing";
  if (button.disabled) return "disabled";
  button.click();
  return "clicked";
})()`;

// retried until it lands: the button may draw a moment after its scope does, and one pressed a
// render before its state enables it is refused.
export const clickButtonIn = async (
  browser: AgentBrowser,
  scope: string,
  name: string,
  deadlineMs = 30_000,
): Promise<void> => {
  await pollUntil(
    async () => parseEval(await browser(["eval", pressButtonIn(scope, name)]), z.string()),
    (outcome) => outcome === "clicked",
    { deadlineMs, describe: (outcome) => `the ${name} button in ${scope} stayed ${outcome}` },
  );
};

// a row whose text runs on past its name (a rail row's count, a chip's), found by how it starts
const pressStartingWith = (scope: string, prefix: string): string => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)});
  const button = root ? [...root.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith(${JSON.stringify(prefix)})) : null;
  if (!button) return "missing";
  if (button.disabled) return "disabled";
  button.click();
  return "clicked";
})()`;

export const clickStartingWith = async (
  browser: AgentBrowser,
  scope: string,
  prefix: string,
  deadlineMs = 30_000,
): Promise<void> => {
  await pollUntil(
    async () => parseEval(await browser(["eval", pressStartingWith(scope, prefix)]), z.string()),
    (outcome) => outcome === "clicked",
    { deadlineMs, describe: (outcome) => `the ${prefix} row in ${scope} stayed ${outcome}` },
  );
};

// longer than slate-react's 100 ms selection throttle, so a read taken this long after a move comes
// after the editor's own read of it
const SELECTION_SETTLE_MS = 250;

const paragraphBox = (editor: string, text: string): string =>
  `JSON.stringify((() => { const el = [...document.querySelectorAll(${JSON.stringify(`${editor} p`)})].find((p) => p.textContent === ${JSON.stringify(text)}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2), right: Math.round(r.right) }; })())`;

// a drag across one line's paragraph, as a reader selects. slate-react reads the page's selection on
// a 100 ms throttle, and Editable's layout effect writes the range it last read back over the
// page's on any render while focused, so a render between a move and the read after it puts the
// older range back, and a drag with no later move keeps it. A hand keeps moving, and so does this:
// the button held, the move to the line's end repeats until the paragraph is still selected a
// throttle period after it, when the editor has read it.
export const dragSelectParagraph = async (
  browser: AgentBrowser,
  editor: string,
  text: string,
  deadlineMs = 30_000,
): Promise<void> => {
  const box = parseEval(
    await browser(["eval", paragraphBox(editor, text)]),
    z.object({ right: z.number(), x: z.number(), y: z.number() }),
  );
  await browser(["mouse", "move", String(box.x + 1), String(box.y)]);
  await browser(["mouse", "down"]);
  try {
    await browser(["mouse", "move", String(box.x + 40), String(box.y)]);
    await pollUntil(
      async () => {
        await browser(["mouse", "move", String(box.right - 1), String(box.y)]);
        await delay(SELECTION_SETTLE_MS);
        return parseEval(await browser(["eval", "String(window.getSelection())"]), z.string());
      },
      (selected) => selected.includes(text),
      { deadlineMs, describe: (selected) => `the drag held "${selected}", not "${text}"` },
    );
  } finally {
    await browser(["mouse", "up"]);
  }
};

// the query the page's url carries: the open item, or none on the library
export const openItemParam = async (browser: AgentBrowser): Promise<string | null> =>
  parseEval(
    await browser(["eval", `String(new URLSearchParams(location.search).get("item") ?? "")`]),
    z.string(),
  ) || null;

export const untilBodyHolds = async (
  browser: AgentBrowser,
  needles: readonly string[],
  deadlineMs = 30_000,
): Promise<void> => {
  await pollUntil(
    async () => await browser(["get", "text", "body"]),
    (body) => needles.every((needle) => body.includes(needle)),
    {
      deadlineMs,
      describe: (body) => {
        const missing = needles.filter((needle) => !body.includes(needle));
        return `the page never said ${missing.map((needle) => `"${needle}"`).join(" and ")}:\n${body}`;
      },
      intervalMs: 500,
    },
  );
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

export interface ScenarioBrowserOptions {
  // a browser profile, an unpacked extension: what the session's browser launches with
  launchFlags?: readonly string[];
}

export const createScenarioBrowser = (
  label: string,
  launch: ScenarioBrowserOptions = {},
): ScenarioBrowser => {
  const run = agentBrowserSession(label, launch.launchFlags);
  const controls: ScenarioBrowserControls = {
    close: async () => {
      await closeQuietly(run);
    },
    openWorkspace: async (app, options = {}) => {
      const url = await app.browserUrl(options.path ?? "/");
      await run(["open", url], 60_000);
      await run(["wait", SIDEBAR], 90_000);
      await run(["wait", options.ready ?? LIBRARY_GRID], 90_000);
    },
  };
  return Object.assign(run, controls);
};
