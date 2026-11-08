import { setTimeout as delay } from "node:timers/promises";
import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";
import { z } from "zod";
import { skip } from "./assert";
import { describeExecError, exec } from "./exec";
import { OWNER } from "./cloud-account";
import type { CloudWorker } from "./cloud-worker";
import { pollUntil } from "./poll";
import { LIBRARY_RAIL, SUBMIT_READY } from "./selectors";

export type AgentBrowser = (args: readonly string[], timeoutMs?: number) => Promise<string>;

export interface OpenLibraryOptions {
  // under the page's prefix, its query included (`?item=<id>` opens an item)
  path?: string;
  // what the page shows once it is ready: its rail, unless the caller names the editor instead
  ready?: string;
}

interface ScenarioBrowserControls {
  // signs the browser in as the account `signUp` made, through the site's own sign-in, which comes
  // back to the library's page, and returns once the page's rail and `ready` mounted. Sign-in is the
  // page's first run: there is nothing to choose before it.
  openLibrary: (worker: CloudWorker, options?: OpenLibraryOptions) => Promise<void>;
  // the same sign-in with nothing asking to come back, which lands in the library
  signInBare: (worker: CloudWorker) => Promise<void>;
  close: () => Promise<void>;
}

export type ScenarioBrowser = AgentBrowser & ScenarioBrowserControls;

// launchFlags ride every call, after --session: agent-browser launches its browser on whichever
// call comes first, so a flag only the first call carried would launch nothing once a later one did.
const agentBrowserSession = (label: string, launchFlags: readonly string[] = []): AgentBrowser => {
  // the label leads with its scenario's name (scenario.ts), so two scenarios in two lanes never
  // share a session's browser, and the pid keeps two runs of the suite apart.
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

// the element itself pressed, wherever it is drawn: a pointer's click lands where a sliding surface
// was a moment ago. Retried until it lands, as `clickButtonIn` is.
const pressElement = (selector: string): string => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!(element instanceof HTMLElement)) return "missing";
  if (element instanceof HTMLButtonElement && element.disabled) return "disabled";
  element.click();
  return "clicked";
})()`;

export const press = async (
  browser: AgentBrowser,
  selector: string,
  deadlineMs = 30_000,
): Promise<void> => {
  await pollUntil(
    async () => parseEval(await browser(["eval", pressElement(selector)]), z.string()),
    (outcome) => outcome === "clicked",
    { deadlineMs, describe: (outcome) => `${selector} stayed ${outcome}` },
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

// whether the caret is collapsed at the end of the text node it sits in
const CARET_AT_END =
  "String((() => { const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return false; const r = sel.getRangeAt(0); return r.collapsed && r.endContainer.textContent !== null && r.endOffset === r.endContainer.textContent.length; })())";

// the caret put at the end of the editor's paragraph that holds `text`: a click lands it where the
// pointer was, and an End the editor reads before the click's focus settled goes nowhere, so End
// is pressed again until the caret is seen at the end
export const caretToEndOf = async (
  browser: AgentBrowser,
  text: string,
  deadlineMs = 15_000,
): Promise<void> => {
  await browser(["find", "text", text, "click"]);
  await pollUntil(
    async () => {
      await browser(["press", "End"]);
      await delay(100);
      return parseEval(await browser(["eval", CARET_AT_END]), z.string());
    },
    (atEnd) => atEnd === "true",
    { deadlineMs, describe: () => `the caret never reached the end of "${text}"` },
  );
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
  const signIn = async (signInUrl: string): Promise<void> => {
    await run(["open", signInUrl], 60_000);
    await run(["wait", "#email"], 60_000);
    await run(["fill", "#email", OWNER.email]);
    await run(["fill", "#password", OWNER.password]);
    await run(["wait", SUBMIT_READY], 60_000);
    await run(["click", SUBMIT_READY]);
    await run(["wait", LIBRARY_RAIL], 90_000);
  };
  const controls: ScenarioBrowserControls = {
    close: async () => {
      await closeQuietly(run);
    },
    openLibrary: async (worker, options = {}) => {
      const next = `${LIBRARY_PAGE_PATH}${options.path ?? ""}`;
      await signIn(`${worker.origin}/app/sign-in?${new URLSearchParams({ next }).toString()}`);
      if (options.ready !== undefined) {
        await run(["wait", options.ready], 90_000);
      }
    },
    signInBare: async (worker) => {
      await signIn(`${worker.origin}/app/sign-in`);
    },
  };
  return Object.assign(run, controls);
};
