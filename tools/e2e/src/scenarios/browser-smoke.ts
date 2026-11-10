import { setTimeout as delay } from "node:timers/promises";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { z } from "zod";
import { modChord, parseEval, untilBodyHolds } from "../harness/agent-browser";
import type { ScenarioBrowser } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, PALETTE_INPUT, doubleClickCard, libraryCard } from "../harness/selectors";

const MOUNT_DEADLINE_MS = 60_000;
// a late async failure must not slip in after the error sweep.
const QUIESCENCE_MS = 1000;
const PALETTE_CHORD = modChord("p");
const PHONE_WIDTH = 375;
const WELCOME = "Welcome to your library";
const TYPED = " Typed in the tab.";

const LIBRARY_HEADERS = {
  "cache-control": "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
} as const;

// a script tag with no src, which runs only by the nonce; data blocks run nothing
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>/gu;
const DATA_BLOCK = /type="application\/(?:ld\+)?json"/u;

// the library's chunk group and its route's stylesheet, by the name vite.config.ts gives them
const LIBRARY_ASSET = /\/assets\/library-[\w-]{8}\.(?:js|css)/gu;
const LINK_TAG = /<link\b[^>]*>/gu;
const HREF = /\bhref="(?<href>[^"]+)"/u;

const stylesheets = (html: string): string[] =>
  [...html.matchAll(LINK_TAG)]
    .map((match) => match[0])
    .filter((tag) => tag.includes('rel="stylesheet"'))
    .map((tag) => HREF.exec(tag)?.groups?.href ?? "");

interface Answered {
  readonly html: string;
  readonly nonce: string;
  readonly response: Response;
}

// here, not a unit test: no test task waits on a build, so a unit test over the assets reads the
// previous build or one mid-write
const documentAt = async (origin: string, path: string): Promise<Answered> => {
  const response = await fetch(`${origin}${path}`, { headers: { accept: "text/html" } });
  expect(response.ok, `GET ${path} answered ${String(response.status)}`);
  const policy = response.headers.get("content-security-policy") ?? "";
  const scripts = policy.split("; ").find((directive) => directive.startsWith("script-src")) ?? "";
  const nonce = /'nonce-(?<nonce>[^']+)'/u.exec(scripts)?.groups?.nonce ?? "";
  expect(nonce !== "", `${path}'s document names no nonce for its scripts: ${policy}`);
  expect(
    !scripts.includes("'unsafe-inline'"),
    `${path}'s policy runs any inline script: ${policy}`,
  );
  expect(policy.includes(" ipc:"), `${path}'s policy keeps the Mac app's commands out: ${policy}`);
  const html = await response.text();
  const unsigned = [...html.matchAll(INLINE_SCRIPT)]
    .map((match) => match[0])
    .filter((tag) => !DATA_BLOCK.test(tag) && !tag.includes(`nonce="${nonce}"`));
  expect(
    unsigned.length === 0,
    `${path} carries inline scripts without its nonce:\n${unsigned.join("\n")}`,
  );
  return { html, nonce, response };
};

const assertDocumentPolicy = async (origin: string): Promise<void> => {
  const page = await documentAt(origin, LIBRARY_PAGE_PATH);
  const settings = await documentAt(origin, `${LIBRARY_PAGE_PATH}/settings`);
  expect(page.nonce !== settings.nonce, "two documents were answered under one nonce");
  for (const [path, { response }] of [
    [LIBRARY_PAGE_PATH, page],
    [`${LIBRARY_PAGE_PATH}/settings`, settings],
  ] as const) {
    for (const [name, value] of Object.entries(LIBRARY_HEADERS)) {
      expect(
        response.headers.get(name) === value,
        `${path} answered ${name}: ${String(response.headers.get(name))}`,
      );
    }
  }

  const libraryOnly = new Set([
    ...[...page.html.matchAll(LIBRARY_ASSET)].map((match) => match[0]),
    ...stylesheets(page.html),
  ]);
  expect(libraryOnly.size > 0, "the library's document links no chunk or stylesheet of its own");
  const home = await documentAt(origin, "/");
  const shared = [...libraryOnly].filter((asset) => home.html.includes(asset));
  expect(shared.length === 0, `the site's home loads the library's:\n${shared.join("\n")}`);

  const site = await fetch(`${origin}/libraryish`);
  await site.arrayBuffer();
  expect(
    site.status === 404,
    `a path that only starts like the page's answered ${String(site.status)}`,
  );
};

// the policy's tables are the site's widest thing: one that sets the page's width sends the page
// sideways and takes the fixed header off a phone's screen, on a width no suite renders
const assertPhoneWidth = async (browser: ScenarioBrowser, origin: string): Promise<void> => {
  await browser(["set", "viewport", String(PHONE_WIDTH), "812"]);
  await browser(["open", `${origin}/privacy`], 60_000);
  const { header, page } = parseEval(
    await browser([
      "eval",
      `JSON.stringify({
        header: document.querySelector("header").getBoundingClientRect().right,
        page: document.documentElement.scrollWidth,
      })`,
    ]),
    z.object({ header: z.number(), page: z.number() }),
  );
  expect(page <= PHONE_WIDTH, `the privacy page is ${String(page)}px wide on a phone`);
  expect(header <= PHONE_WIDTH, `the site's header ends at ${String(header)}px on a phone`);
};

export const browserSmoke: Scenario = {
  description:
    "the library's page served by the built Worker at /library under the nonce policy every document carries, the site's home loading none of it, a signed-out tab sent to the site's sign-in and back, a bare sign-in landing in the library, the library read into the tab from the cell, an item opened and edited into the cell, the palette chord safe over the editor, and a clean console after a settle window",
  name: "browser-smoke",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const tab = await openLibraryTab(ctx, "smoke", async (library) => {
      const { item } = await library.items.createNote({
        markdown: `# ${WELCOME}\n\nStart here.`,
        title: WELCOME,
      });
      return item.id;
    });
    const { browser, library, seeded: welcomeId, worker } = tab;

    ctx.log("every document carries the nonce policy, and the site's home none of the library");
    await assertDocumentPolicy(worker.origin);

    ctx.log("a tab with no session is sent to the site's sign-in, told to come back");
    const fresh = await ctx.browser("smoke-signed-out");
    await fresh(["open", `${worker.origin}/library/settings`], 60_000);
    await pollUntil(
      async () => await fresh(["get", "url"]),
      (url) => url.includes("/app/sign-in"),
      {
        deadlineMs: MOUNT_DEADLINE_MS,
        describe: (url) => `the signed-out tab stayed on ${url}`,
      },
    );
    const back = new URL(await fresh(["get", "url"])).searchParams.get("next");
    expect(back === `${LIBRARY_PAGE_PATH}/settings`, `the sign-in comes back to ${String(back)}`);

    ctx.log("a sign-in nothing asked to come back from lands in the library");
    await fresh.signInBare(worker);
    await fresh.close();

    ctx.log("the site's widest page keeps a phone's width");
    const phone = await ctx.browser("smoke-phone");
    await assertPhoneWidth(phone, worker.origin);
    await phone.close();

    ctx.log("the signed-in tab read the library: the seeded item's card is in the grid");
    await browser(["wait", libraryCard(welcomeId)], MOUNT_DEADLINE_MS);
    const title = await browser(["get", "title"]);
    expect(title === "inteligir", `document title is ${JSON.stringify(title)}`);

    ctx.log("a double-click opens the item in the editor, and the url names it");
    expect(
      parseEval(await browser(["eval", doubleClickCard(welcomeId)]), z.string()) === "opened",
      "the card was not found to open",
    );
    await browser(["wait", EDITOR], MOUNT_DEADLINE_MS);
    await untilBodyHolds(browser, ["Start here."]);

    ctx.log("typing reaches the item's note, and the library holds it");
    await browser(["click", `${EDITOR} p`]);
    await browser(["press", "End"]);
    await browser(["keyboard", "type", TYPED]);
    await untilItemText(
      library,
      welcomeId,
      (markdown) => markdown.includes(TYPED.trim()),
      "the edit never reached the cell",
    );

    ctx.log("the palette chord opens the palette without editing the item under it");
    const before = await untilItemText(library, welcomeId, () => true, "unread");
    await browser(["press", PALETTE_CHORD]);
    await browser(["wait", PALETTE_INPUT], 30_000);
    await browser(["press", "Escape"]);
    await delay(2500);
    const after = await untilItemText(library, welcomeId, () => true, "unread");
    expect(after === before, `${PALETTE_CHORD} changed the item:\n${after}`);

    ctx.log("settling, then sweeping for page and console errors");
    await delay(QUIESCENCE_MS);
    const pageErrors = await browser(["errors"]);
    expect(
      pageErrors.length === 0 || /^no /iu.test(pageErrors),
      `page errors were raised:\n${pageErrors}`,
    );
    const consoleOutput = await browser(["console"]);
    const errorLines = consoleOutput
      .split("\n")
      .filter((line) => /^\s*\[?err(?:or)?\]?\b/iu.test(line));
    expect(errorLines.length === 0, `console errors were logged:\n${errorLines.join("\n")}`);
  },
};
