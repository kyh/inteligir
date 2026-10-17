// the library in a browser over real fills, end to end across the lanes: a link pasted into the
// window (W) is a pending card, and opened at once it shows its placeholder while the Mac reads
// the page (S1), through the rename to the page's title, which the open item follows by its id and
// the url's `?item=` with it, until the canonical article replaces the placeholder. A passage of it
// is highlighted in the editor (W over S3's store), Info names the site, and Keep a copy of the
// page frames a copy whose own route (S2) answers the frame's url, media token and all, under a
// script-less sandbox. A popup-style save of a link already held, with keepCopy, adds a copy to
// that item rather than making another. The page is held by the fixture until the item is open,
// so the placeholder is on screen for certain. The pages are served on this machine's own network
// address, so a machine with none the guard reads from skips at the start.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PAGE_COPY_PATH } from "@repo/contract/local/routes";
import { z } from "zod";
import { clickButtonIn, modChord, openItemParam, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { AppInstance } from "../harness/instance";
import { startLanFixture } from "../harness/lan-fixture";
import type { LanFixture, LanRoute } from "../harness/lan-fixture";
import { pollUntil } from "../harness/poll";
import type { Scenario, ScenarioContext } from "../harness/scenario";
import { EDITOR, LIBRARY_TITLE, libraryCard } from "../harness/selectors";

const TITLE = "Keeping notes in plain files";
const ITEM = `Unsorted/${TITLE}.md`;
const SITE = "The LAN Journal";
const OPENING =
  "A folder of text files outlasts every app that reads it. The files are yours, on your own disk.";
// short enough to sit on one line of the editor, so a drag across it selects all of it
const PASSAGE = "Plain text has been readable for fifty years.";
const SECOND_TITLE = "A second page worth keeping";
const DEADLINE_MS = 30_000;
const FILL_DEADLINE_MS = 60_000;

const ARTICLE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${TITLE}</title>`,
  `<meta property="og:site_name" content="${SITE}">`,
  '<meta name="description" content="Why a folder of text files outlasts every app that reads it.">',
  '<link rel="stylesheet" href="/style.css">',
  "</head><body>",
  '<nav><a href="/">Home</a> <a href="/about">About</a></nav>',
  "<article>",
  `<h1>${TITLE}</h1>`,
  `<p>${OPENING}</p>`,
  "<h2>What lasts</h2>",
  `<p>${PASSAGE}</p>`,
  "<p>Nothing suggests that will change soon, so the files are the thing to keep.</p>",
  "</article>",
  '<script>document.title = "ran";</script>',
  "<footer>Written on a quiet afternoon.</footer>",
  "</body></html>",
].join("\n");

const SECOND_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${SECOND_TITLE}</title>`,
  `<meta property="og:site_name" content="${SITE}">`,
  '<link rel="stylesheet" href="/style.css">',
  "</head><body><article>",
  `<h1>${SECOND_TITLE}</h1>`,
  "<p>The copy keeps how this page looked, its colours and its type, with none of its script.</p>",
  "<p>It is saved once, beside the item, and opens in the item's own view.</p>",
  "</article>",
  '<script>document.title = "ran";</script>',
  "</body></html>",
].join("\n");

const ROUTES = {
  "/essay": { body: ARTICLE },
  "/second": { body: SECOND_PAGE },
  "/style.css": { body: "body { color: rgb(1, 2, 3); }", type: "text/css; charset=utf-8" },
} satisfies Record<string, LanRoute>;

const NOTE_FIELD = 'textarea[aria-label="Note"]';
const COPY_LINK = /\[Copy of the page\]\((?<copy>assets\/pages\/[0-9a-f]{16}\.html)\)/u;
const MARKERS = /%%i:(?<id>[a-z0-9]+):start%%(?<words>[^%]+)%%i:\k<id>:end%%/u;

// what a paste carries, built in the page the way the browser hands it over
const pasteScript = (url: string): string => `(() => {
  const data = new DataTransfer();
  data.setData("text/plain", ${JSON.stringify(url)});
  document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  return "pasted";
})()`;

// the open item as the window shows it, every time anything in it changes: the url's item and
// the stage on screen ("article" is the editor under the item's own bar), each change once
const RECORD_STAGES = `(() => {
  window.e2eStages = [];
  const read = () => {
    const param = new URLSearchParams(location.search).get("item") ?? "";
    const staged = document.querySelector("[data-item-stage]")?.getAttribute("data-item-stage");
    const stage =
      staged ??
      (document.querySelector('[data-item-view] [data-slate-editor="true"]') !== null
        ? "article"
        : document.querySelector('[data-slot="card-grid"]') !== null
          ? "library"
          : "none");
    const last = window.e2eStages.at(-1);
    if (last === undefined || last.param !== param || last.stage !== stage) {
      window.e2eStages.push({ param, stage });
    }
  };
  read();
  new MutationObserver(read).observe(document.body, { attributes: true, childList: true, subtree: true });
  window.setInterval(read, 50);
  return "recording";
})()`;
const STAGES = "JSON.stringify(window.e2eStages ?? [])";
const stagesSchema = z.array(z.object({ param: z.string(), stage: z.string() }));

const SITE_ROW = `String((() => {
  const label = [...document.querySelectorAll("span")].find((el) => el.textContent === "Site");
  return label?.nextElementSibling?.textContent ?? "";
})())`;

const onDisk = async (app: AppInstance, vaultPath: string): Promise<string> =>
  await readFile(path.join(app.vaultDir, vaultPath), "utf-8").catch(() => "");

const untilDisk = async (
  app: AppInstance,
  vaultPath: string,
  holds: (text: string) => boolean,
  what: string,
  deadlineMs = DEADLINE_MS,
): Promise<string> =>
  await pollUntil(async () => await onDisk(app, vaultPath), holds, {
    deadlineMs,
    describe: (text) => `${what}; ${vaultPath} holds:\n${text}`,
  });

const untilItemParam = async (browser: AgentBrowser, wanted: string): Promise<void> => {
  await pollUntil(
    async () => await openItemParam(browser),
    (param) => param === wanted,
    {
      deadlineMs: FILL_DEADLINE_MS,
      describe: (param) => `the url names ${String(param)}, not ${wanted}`,
    },
  );
};

// the stub the paste made, by its url: its path is a name the url gave it until the fill renames it
const pastedStub = async (app: AppInstance, url: string): Promise<string> => {
  const { items } = await pollUntil(
    async () => await app.api.knowledge.findByUrl({ url }),
    (found) => found.items.length === 1,
    {
      deadlineMs: DEADLINE_MS,
      describe: (found) => `the pasted link is ${String(found.items.length)} items`,
    },
  );
  const [stub] = items;
  expect(stub?.pending === true, `the pasted link is no stub: ${JSON.stringify(stub)}`);
  return stub.path;
};

const pasteAndOpenWhileHeld = async (
  ctx: ScenarioContext,
  app: AppInstance,
  browser: AgentBrowser,
  lan: LanFixture,
): Promise<string> => {
  ctx.log("a link pasted into the library is a pending card, and opens on its placeholder");
  // the page is held until a second request asks for it, which the scenario makes once the item
  // is open; the hold is a few seconds, well inside the fetch's own deadline and the auto-commit's
  // quiet window, so the stub is still this Mac's own and untracked when the fill renames it
  lan.gate("/essay", 2);
  await browser(["click", LIBRARY_TITLE]);
  await browser(["eval", pasteScript(lan.url("/essay"))]);
  const provisional = await pastedStub(app, lan.url("/essay"));
  await browser(["wait", libraryCard(provisional)], DEADLINE_MS);
  const cardText = await browser(["get", "text", libraryCard(provisional)]);
  expect(cardText.includes("Filling in…"), `the pasted card is not pending: ${cardText}`);
  await browser(["dblclick", libraryCard(provisional)]);
  await browser(["wait", '[data-item-stage="pending"]'], DEADLINE_MS);
  await untilItemParam(browser, provisional);
  expectEq(
    parseEval(await browser(["eval", RECORD_STAGES]), z.string()),
    "recording",
    "the stage recorder",
  );
  return provisional;
};

const followsTheRename = async (
  ctx: ScenarioContext,
  app: AppInstance,
  browser: AgentBrowser,
  lan: LanFixture,
  provisional: string,
): Promise<void> => {
  ctx.log("the page answers: the stub is renamed to its title under the open item, then filled");
  const released = await fetch(lan.url("/essay"));
  expectEq(released.status, 200, "the fixture's answer to the request that releases the page");
  await untilItemParam(browser, ITEM);
  await browser(["wait", `[data-item-view] ${EDITOR}`], FILL_DEADLINE_MS);
  await pollUntil(
    async () => await browser(["get", "text", EDITOR]),
    (text) => text.includes(OPENING) && text.includes(PASSAGE),
    {
      deadlineMs: DEADLINE_MS,
      describe: (text) => `the editor never showed the article:\n${text}`,
    },
  );
  const header = await browser(["get", "text", "[data-source-header]"]);
  expect(header.includes(SITE), `the item's header does not name its site: ${header}`);

  const stages = stagesSchema.parse(
    JSON.parse(parseEval(await browser(["eval", STAGES]), z.string())),
  );
  const shown = JSON.stringify(stages);
  expectEq(stages[0], { param: provisional, stage: "pending" }, "the first stage recorded");
  expectEq(stages.at(-1), { param: ITEM, stage: "article" }, "the last stage recorded");
  expect(
    stages.every((seen) => seen.stage !== "library"),
    `the open item dropped to the library on the way: ${shown}`,
  );
  expect(
    stages.every((seen) => seen.param !== provisional || ["pending", "none"].includes(seen.stage)),
    `the stub's own name showed something other than its placeholder: ${shown}`,
  );
  expect(
    stages.every((seen) => seen.stage !== "article" || seen.param === ITEM),
    `the article showed under another name: ${shown}`,
  );

  const content = await onDisk(app, ITEM);
  for (const line of ["kind: link", `url: ${lan.url("/essay")}`, `site: ${SITE}`]) {
    expect(content.includes(`\n${line}\n`), `the item's frontmatter holds "${line}":\n${content}`);
  }
  expectEq(await onDisk(app, provisional), "", "the stub's provisional name, once renamed");
};

const highlightsAPassage = async (
  ctx: ScenarioContext,
  app: AppInstance,
  browser: AgentBrowser,
): Promise<void> => {
  ctx.log("a passage of the article, selected with the mouse and ⌘⇧H, is a highlight");
  const box = parseEval(
    await browser([
      "eval",
      `JSON.stringify((() => { const el = [...document.querySelectorAll('${EDITOR} p')].find((p) => p.textContent === ${JSON.stringify(PASSAGE)}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2), right: Math.round(r.right) }; })())`,
    ]),
    z.object({ right: z.number(), x: z.number(), y: z.number() }),
  );
  await browser(["mouse", "move", String(box.x + 1), String(box.y)]);
  await browser(["mouse", "down"]);
  await browser(["mouse", "move", String(box.x + 40), String(box.y)]);
  await browser(["mouse", "move", String(box.right - 1), String(box.y)]);
  await browser(["mouse", "up"]);
  await pollUntil(
    async () => parseEval(await browser(["eval", "String(window.getSelection())"]), z.string()),
    (selected) => selected.length > 10,
    { deadlineMs: DEADLINE_MS, describe: (selected) => `nothing selected: "${selected}"` },
  );
  await browser(["press", modChord("Shift+h")]);
  const marked = await untilDisk(app, ITEM, (text) => MARKERS.test(text), "no markers landed");
  // the highlight offers a note; Escape in its field keeps the bare highlight
  await browser(["wait", NOTE_FIELD], DEADLINE_MS);
  await browser(["click", NOTE_FIELD]);
  await browser(["press", "Escape"]);
  await pollUntil(
    async () =>
      parseEval(
        await browser(["eval", `String(document.querySelector('${NOTE_FIELD}') === null)`]),
        z.string(),
      ),
    (gone) => gone === "true",
    { deadlineMs: DEADLINE_MS, describe: () => "the note field stayed open" },
  );
  const id = MARKERS.exec(marked)?.groups?.["id"] ?? "";
  const listed = await pollUntil(
    async () => await app.api.annotations.list({ path: ITEM }),
    (answer) => answer.annotations.some((annotation) => annotation.id === id),
    { deadlineMs: DEADLINE_MS, describe: () => `the highlight ${id} has no entry` },
  );
  const entry = listed.annotations.find((annotation) => annotation.id === id);
  expectEq(entry?.state, "anchored", "the highlight's state");
  expect(
    entry?.quote?.includes("Plain text has been readable") === true,
    `the highlight does not quote the passage: ${String(entry?.quote)}`,
  );
};

const infoKeepsACopy = async (
  ctx: ScenarioContext,
  app: AppInstance,
  browser: AgentBrowser,
): Promise<void> => {
  ctx.log("Info names the item's site");
  await browser(["click", 'button[aria-label="Toggle panel"]']);
  await pollUntil(
    async () => parseEval(await browser(["eval", SITE_ROW]), z.string()),
    (site) => site === SITE,
    { deadlineMs: DEADLINE_MS, describe: (site) => `Info's Site row reads "${site}"` },
  );

  ctx.log("Keep a copy of the page links a copy, and the item shows it on its own face");
  await clickButtonIn(browser, "body", "Keep a copy of the page");
  const withCopy = await untilDisk(
    app,
    ITEM,
    (text) => COPY_LINK.test(text),
    "the copy was never linked",
    FILL_DEADLINE_MS,
  );
  const copy = COPY_LINK.exec(withCopy)?.groups?.["copy"] ?? "";
  expect(MARKERS.test(withCopy), `the copy's write kept the highlight:\n${withCopy}`);
  const kept = await onDisk(app, copy);
  expect(kept.includes("rgb(1, 2, 3)"), "the copy holds the page's stylesheet");
  expect(!kept.includes("<script"), "the copy holds no script");

  await clickButtonIn(browser, '[aria-label="Show"]', "Page copy");
  const frame = '[data-item-stage="page-copy"] iframe';
  await browser(["wait", frame], DEADLINE_MS);
  const src = parseEval(
    await browser(["eval", `String(document.querySelector('${frame}').getAttribute("src"))`]),
    z.string(),
  );
  expect(
    src.includes(`${PAGE_COPY_PATH}?`) &&
      src.includes(encodeURIComponent(copy)) &&
      /[?&]m=/u.test(src),
    `the frame is not the copy's route with the media token: ${src}`,
  );

  ctx.log("the frame's own url answers the copy under a script-less sandbox");
  const answered = parseEval(
    await browser([
      "eval",
      `(async () => {
        const response = await fetch(${JSON.stringify(src)});
        return JSON.stringify({ policy: response.headers.get("content-security-policy") ?? "", status: response.status, text: await response.text() });
      })()`,
    ]),
    z.object({ policy: z.string(), status: z.number(), text: z.string() }),
  );
  expectEq(answered.status, 200, "the copy route's answer to the frame's url");
  const directives = new Set(answered.policy.split(";").map((part) => part.trim()));
  expect(
    directives.has("sandbox") &&
      directives.has("default-src 'none'") &&
      !answered.policy.includes("allow-scripts"),
    `the copy is not served under a script-less sandbox: ${answered.policy}`,
  );
  expectEq(answered.text, kept, "the copy the frame is served");
};

const popupResaveKeepsACopy = async (
  ctx: ScenarioContext,
  app: AppInstance,
  lan: LanFixture,
): Promise<void> => {
  ctx.log("a page saved without a copy, then saved again from the popup with one");
  const url = lan.url("/second");
  const first = await app.api.items.saveLink({ url, wait: true });
  expectEq([first.outcome, first.fill], ["created", { state: "filled" }], "the first save");
  const item = first.path;
  expectEq(item, `Unsorted/${SECOND_TITLE}.md`, "the second item's name, from its title");
  expect(!COPY_LINK.test(await onDisk(app, item)), "the first save kept no copy");

  // the popup's "Keep a copy of the page" sends the page it captured again, with the switch on
  const again = await app.api.items.savePage({
    keepCopy: true,
    page: { html: SECOND_PAGE, selection: null, title: SECOND_TITLE, url },
    wait: true,
  });
  expectEq([again.outcome, again.path], ["exists", item], "the popup's second save");
  const withCopy = await untilDisk(
    app,
    item,
    (text) => COPY_LINK.test(text),
    "the popup's save never added the copy",
    FILL_DEADLINE_MS,
  );
  const kept = await onDisk(app, COPY_LINK.exec(withCopy)?.groups?.["copy"] ?? "");
  expect(
    kept.includes("rgb(1, 2, 3)") && !kept.includes("<script"),
    "the copy keeps the page's stylesheet and none of its script",
  );
  const { items } = await app.api.knowledge.findByUrl({ url });
  expectEq(
    items.map((row) => row.path),
    [item],
    "the items that hold the link: the copy went to the one there was",
  );
};

export const libraryIntegrated: Scenario = {
  description:
    "a pasted LAN-fixture link opens on its placeholder through its rename to the canonical article; a highlight; Info's site; Keep a copy and its sandboxed frame; a popup re-save with keepCopy adds the copy to that item",
  name: "library-integrated",
  async run(ctx) {
    const lan = await startLanFixture(ROUTES);
    try {
      const app = await ctx.boot({ name: "solo" });
      const browser = await ctx.browser("library-integrated");
      await browser.openWorkspace(app);
      const provisional = await pasteAndOpenWhileHeld(ctx, app, browser, lan);
      await followsTheRename(ctx, app, browser, lan, provisional);
      await highlightsAPassage(ctx, app, browser);
      await infoKeepsACopy(ctx, app, browser);
      await popupResaveKeepsACopy(ctx, app, lan);
    } finally {
      await lan.close();
    }
  },
  timeoutMs: 240_000,
};
