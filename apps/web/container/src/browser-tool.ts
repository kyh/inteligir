// ---------------------------------------------------------------------------
// The `browser` tool — the one capability this image implements itself.
//
// Everything else the agent may do is a relay into the Durable Object (./tools).
// This one cannot be: it is a browser session on Cloudflare Browser Run, driven
// over the Chrome DevTools Protocol, and the driving has to happen where the
// process is.
//
// WHETHER IT WORKS AT ALL IS UNVERIFIED. CDP is a `wss://` upgrade, and the
// Sandbox outbound documentation covers HTTP and HTTPS on ports 80 and 443
// without ever naming the WebSocket upgrade. So this module is written for the
// case where the connect never lands: the attempt is bounded by an explicit
// timeout — never an unbounded hang inside a turn nobody can interrupt — and a
// failure answers with a sentence that says what was attempted, that the
// egress path is unproven, and what an operator should check. A tool that fails
// with "connect ETIMEDOUT" teaches nobody anything.
//
// The credential rides IN, on the connect's Authorization header, rather than
// being injected on the way out: the outbound interceptor is HTTP-only, so
// there is nothing for it to rewrite here.
//
// The surface is four verbs. Cloudflare's browser is remote and persistent, so
// each call attaches, acts and detaches — the page survives between calls, and
// `goto` then `text` reads the page `goto` opened.
// ---------------------------------------------------------------------------

import { chromium } from "playwright-core";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { ContainerTool, ContainerToolResult } from "./tools";

/** Attach budget. Past this the upgrade is not coming, and a turn that waited
 * longer would be a chat that looks hung. */
const CONNECT_TIMEOUT_MS = 20_000;
/** Per-action budget once attached. Navigation dominates; a selector that never
 * matches must still answer. */
const ACTION_TIMEOUT_MS = 30_000;
/** Page text handed to the model. A long article is already more than a turn
 * can use, and the whole DOM is a context overflow. */
const MAX_TEXT_CHARS = 20_000;

const BrowserSchema = Type.Object({
  action: Type.Union(
    [Type.Literal("goto"), Type.Literal("text"), Type.Literal("screenshot"), Type.Literal("click")],
    {
      description:
        "goto: open `url`. text: read the page's visible text (all of it, or just `selector`). " +
        "screenshot: capture the viewport. click: click `selector`.",
    },
  ),
  url: Type.Optional(Type.String({ description: "Absolute URL. Required for `goto`." })),
  selector: Type.Optional(
    Type.String({
      description:
        "CSS selector. Required for `click`; optional for `text` (defaults to the whole page).",
    }),
  ),
});

const DESCRIPTION =
  "Drive a remote headless browser: open a page, read its text, screenshot it, or click something. " +
  "Use it for pages you cannot otherwise read. The browser is remote and keeps its page between " +
  "calls, so `goto` then `text` reads the page you opened.";

/** The tool, or `null` when this deployment has no Browser Run credentials —
 * an unusable tool in the model's menu is worse than a missing one, because the
 * model spends a turn discovering it. */
export function createBrowserTool(url: string | null, token: string | null): ContainerTool | null {
  if (url === null || token === null || url === "" || token === "") return null;
  return {
    name: "browser",
    description: DESCRIPTION,
    parameters: BrowserSchema,
    execute: async (args) => {
      if (!Value.Check(BrowserSchema, args)) {
        return { isError: true, text: "browser: arguments did not match the tool's schema" };
      }
      return run(url, token, args);
    },
  };
}

async function run(
  url: string,
  token: string,
  args: Static<typeof BrowserSchema>,
): Promise<ContainerToolResult> {
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
  try {
    browser = await chromium.connectOverCDP(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: CONNECT_TIMEOUT_MS,
    });
  } catch (error) {
    return { isError: true, text: attachFailure(url, error) };
  }

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    switch (args.action) {
      case "goto": {
        if (args.url === undefined) return { isError: true, text: "browser: `goto` needs a `url`" };
        await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: ACTION_TIMEOUT_MS });
        return { isError: false, text: `Opened ${page.url()} — ${await page.title()}` };
      }
      case "text": {
        const text = await page
          .locator(args.selector ?? "body")
          .first()
          .innerText({ timeout: ACTION_TIMEOUT_MS });
        return { isError: false, text: truncate(text) };
      }
      case "screenshot": {
        const image = await page.screenshot({
          type: "jpeg",
          quality: 60,
          timeout: ACTION_TIMEOUT_MS,
        });
        return {
          isError: false,
          text: `Screenshot of ${page.url()}`,
          image: { data: image.toString("base64"), mimeType: "image/jpeg" },
        };
      }
      case "click": {
        if (args.selector === undefined) {
          return { isError: true, text: "browser: `click` needs a `selector`" };
        }
        await page.locator(args.selector).first().click({ timeout: ACTION_TIMEOUT_MS });
        return { isError: false, text: `Clicked ${args.selector} on ${page.url()}` };
      }
    }
  } catch (error) {
    return { isError: true, text: `browser: ${args.action} failed — ${message(error)}` };
  } finally {
    // Detaches this client; the remote browser and its page stay up for the
    // next call. A leaked connection would hold a Browser Run session open for
    // the life of the container.
    await browser.close().catch(() => undefined);
  }
}

/** The one failure that needs a paragraph rather than a sentence. */
function attachFailure(url: string, error: unknown): string {
  return [
    `browser: could not attach to the Cloudflare Browser Run CDP endpoint at ${redact(url)}.`,
    `Attempted: a WebSocket CDP upgrade with a bearer Authorization header, ${CONNECT_TIMEOUT_MS / 1000}s timeout.`,
    `The underlying error was: ${message(error)}.`,
    "WebSocket egress from a Cloudflare Sandbox is UNVERIFIED — the outbound documentation covers " +
      "HTTP and HTTPS on ports 80 and 443 and never names the WebSocket upgrade, so this may be the " +
      "sandbox refusing the upgrade rather than Browser Run refusing the connection.",
    "Operator check: AGENT_EXTRA_ALLOWED_HOSTS must include api.cloudflare.com, since the sandbox " +
      "runs with enableInternet off and an allowlist.",
  ].join("\n");
}

/** Origin and path only. The endpoint may carry a token in its query, and this
 * string reaches the model and then the user's transcript. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "an endpoint this deployment could not parse as a URL";
  }
}

function truncate(text: string): string {
  return text.length <= MAX_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_TEXT_CHARS)}\n… truncated at ${MAX_TEXT_CHARS} characters; narrow it with a selector.`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
