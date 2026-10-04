// The W3C WebDriver calls the shell scenarios make, against tauri-driver, which fronts
// WebKitWebDriver on Linux. A session is the shell's FIRST window alone: Tauri hands WebKit's
// automation the first web view it makes, and every vault's window lives in a web context of its
// own, so a window made after the first (a vault switch's, the app's after a first run) is watched
// from outside, through the server and its log.

import { z } from "zod";
import { pollUntil } from "./poll";

// the key every W3C answer wraps its value in, and the shape of a refusal
const envelopeSchema = z.object({ value: z.unknown() });
const refusalSchema = z.looseObject({ error: z.string(), message: z.string() });
const sessionSchema = z.looseObject({ sessionId: z.string() });
// the W3C web element reference key
const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const elementSchema = z.object({ [ELEMENT_KEY]: z.string() });

const COMMAND_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

class WebDriverError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "WebDriverError";
    this.code = code;
  }
}

// what a command sends: plain JSON
type JsonBody =
  | string
  | number
  | boolean
  | null
  | readonly JsonBody[]
  | { readonly [key: string]: JsonBody };

interface Command {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: JsonBody;
}

// a command's value, parsed as the caller expects it; a refusal throws with the driver's words
const command = async <T>(origin: string, sent: Command, schema: z.ZodType<T>): Promise<T> => {
  const init: RequestInit = {
    method: sent.method,
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  };
  if (sent.body !== undefined) {
    init.body = JSON.stringify(sent.body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await fetch(`${origin}${sent.path}`, init);
  const { value } = envelopeSchema.parse(await response.json());
  if (!response.ok) {
    const refusal = refusalSchema.safeParse(value);
    throw refusal.success
      ? new WebDriverError(refusal.data.error, refusal.data.message)
      : new WebDriverError("unknown error", JSON.stringify(value));
  }
  return schema.parse(value);
};

export interface WebDriverSession {
  url: () => Promise<string>;
  // the session's windows: one while the first window lives, none once it is gone
  handles: () => Promise<string[]>;
  // a script's value, parsed: `return …` in the page
  run: <T>(script: string, schema: z.ZodType<T>) => Promise<T>;
  // an async script's value: the page calls `done(value)`
  runAsync: <T>(script: string, schema: z.ZodType<T>) => Promise<T>;
  // a real click, through the browser's own input, on the first element the selector names
  click: (selector: string) => Promise<void>;
  // waits until the selector names an element, then clicks it
  clickWhenThere: (selector: string, deadlineMs: number) => Promise<void>;
  // waits until a button whose text or label is `name` is drawn, then clicks it
  clickButton: (name: string, deadlineMs: number) => Promise<void>;
  waitForText: (text: string, deadlineMs: number) => Promise<void>;
  // waits until a page expression is truthy: the session opens with its window, before the page
  // in it has loaded, so a scenario waits for what it is about to use
  waitUntil: (expression: string, deadlineMs: number) => Promise<void>;
  textOf: (selector: string) => Promise<string>;
  close: () => Promise<void>;
}

const BUTTON_SELECTOR = (name: string): string =>
  `return (() => {
    const wanted = ${JSON.stringify(name)};
    const buttons = [...document.querySelectorAll("button, [role=button]")];
    const match = buttons.find(
      (button) => button.getAttribute("aria-label") === wanted || button.textContent?.trim() === wanted,
    );
    if (match === undefined) return null;
    match.setAttribute("data-e2e-target", "");
    return "[data-e2e-target]";
  })()`;

export const openSession = async (
  origin: string,
  application: string,
): Promise<WebDriverSession> => {
  const { sessionId } = await command(
    origin,
    {
      body: { capabilities: { alwaysMatch: { "tauri:options": { application } } } },
      method: "POST",
      path: "/session",
    },
    sessionSchema,
  );
  const at = `/session/${sessionId}`;
  const run = async <T>(script: string, schema: z.ZodType<T>): Promise<T> =>
    await command(
      origin,
      { body: { args: [], script }, method: "POST", path: `${at}/execute/sync` },
      schema,
    );
  const click = async (selector: string): Promise<void> => {
    const found = await command(
      origin,
      { body: { using: "css selector", value: selector }, method: "POST", path: `${at}/element` },
      elementSchema,
    );
    await command(
      origin,
      { body: {}, method: "POST", path: `${at}/element/${found[ELEMENT_KEY]}/click` },
      z.null(),
    );
  };
  const present = async (selector: string): Promise<boolean> =>
    await run(`return document.querySelector(${JSON.stringify(selector)}) !== null`, z.boolean());
  return {
    click,
    async clickButton(name, deadlineMs) {
      // a mark the click finds by, cleared first so a button drawn again is the one clicked
      await run(
        `document.querySelectorAll("[data-e2e-target]").forEach((el) => el.removeAttribute("data-e2e-target")); return null`,
        z.null(),
      );
      const selector = await pollUntil(
        async () => await run(BUTTON_SELECTOR(name), z.string().nullable()),
        (found): found is string => found !== null,
        {
          deadlineMs,
          describe: () => `no button named "${name}" was drawn`,
          intervalMs: POLL_INTERVAL_MS,
        },
      );
      await click(selector);
    },
    async clickWhenThere(selector, deadlineMs) {
      await pollUntil(
        async () => await present(selector),
        (there) => there,
        {
          deadlineMs,
          describe: () => `nothing matched ${selector}`,
          intervalMs: POLL_INTERVAL_MS,
        },
      );
      await click(selector);
    },
    async close() {
      await command(origin, { method: "DELETE", path: at }, z.null()).catch(() => null);
    },
    // a session whose one window is gone may say so as a refusal; any other refusal is a fault
    handles: async () => {
      try {
        return await command(
          origin,
          { method: "GET", path: `${at}/window/handles` },
          z.array(z.string()),
        );
      } catch (error) {
        if (error instanceof WebDriverError && error.code === "no such window") {
          return [];
        }
        throw error;
      }
    },
    run,
    runAsync: async (script, schema) =>
      await command(
        origin,
        {
          body: { args: [], script: `const done = arguments[arguments.length - 1];\n${script}` },
          method: "POST",
          path: `${at}/execute/async`,
        },
        schema,
      ),
    textOf: async (selector) =>
      await run(
        `return document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`,
        z.string(),
      ),
    url: async () => await command(origin, { method: "GET", path: `${at}/url` }, z.string()),
    async waitUntil(expression, deadlineMs) {
      // a document still loading may refuse the script: that is "not yet", and a timeout names
      // the last refusal
      let refused = "";
      await pollUntil(
        async () => {
          try {
            return await run(`return Boolean(${expression})`, z.boolean());
          } catch (error) {
            if (!(error instanceof WebDriverError)) {
              throw error;
            }
            refused = `; the page last refused: ${error.message}`;
            return false;
          }
        },
        (holds) => holds,
        {
          deadlineMs,
          describe: () => `${expression} never held${refused}`,
          intervalMs: POLL_INTERVAL_MS,
        },
      );
    },
    async waitForText(text, deadlineMs) {
      await pollUntil(
        async () => await run("return document.body?.innerText ?? ''", z.string()),
        (body) => body.includes(text),
        {
          deadlineMs,
          describe: (body) => `"${text}" never showed; the page reads:\n${body.slice(0, 2000)}`,
          intervalMs: POLL_INTERVAL_MS,
        },
      );
    },
  };
};
