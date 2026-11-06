// The phone's editor page, built as the app carries it and loaded from `file://` with a scripted
// phone on its bridge: an item's editor over the blocks the phone's replica holds, written back in
// ops, and the headless page that reads a shared page and merges a block two devices changed, each
// answered as its own code answers under node.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

import { nativeFrameScript, PAGE_RECEIVER, pageFrameSchema } from "@repo/editor-bridge/protocol";
import type {
  FillAnswer,
  FillJob,
  MergeSides,
  NativeFrame,
  PageFrame,
  RequestResult,
} from "@repo/editor-bridge/protocol";
import { mergeSides, readPage } from "@repo/mobile-editor/headless-mode";
import { blockHash } from "@repo/notes/library/block-hash";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { noteFields } from "@repo/notes/test-support/library-items";
import { parsePage } from "@repo/page-reader/linkedom-page";

import { parseEval } from "../harness/agent-browser";
import type { ScenarioBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";
import { turboBuildOnce } from "../harness/turbo-build";

// a cold vite build of the page, pele and katex inlined; a cached one returns at once.
const BUILD_TIMEOUT_MS = 300_000;

// past the editor's serialize debounce and the item session's write behind it
const SETTLE_MS = 2000;

const NONCE = "e2e-item-nonce-0123456789";
const ITEM_ID = "0190a000-0000-7000-8000-0000000000e2";
// the item the link names by its id, which went by another name when the link was written
const OTHER_ID = "0190a000-0000-7000-8000-0000000000e3";
const ITEM_PARAGRAPH = "An item's paragraph to type into.";
// a picture a note names by its sha, which the page reads from the phone's file cache
const PICTURE_SHA = "e2".repeat(32);
// one red pixel, a PNG Chromium decodes
const PICTURE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const PICTURE_BLOCK: LibraryBlock = {
  caption: [{ text: "A pixel" }],
  children: [{ text: "" }],
  id: "i1",
  sha: PICTURE_SHA,
  type: "img",
};
const TAB_TEXT = "Tab text.";

type HeldItem = NonNullable<RequestResult<"item">["item"]>;
type ItemOutcome = RequestResult<"writeItem">;

const paragraphBlock = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const TYPED_BLOCK = paragraphBlock("p1", `${ITEM_PARAGRAPH} Typed.`);
const LINK_BLOCK: LibraryBlock = {
  children: [
    { text: "See " },
    { children: [{ text: "" }], itemId: OTHER_ID, title: "Old name", type: "wikiLink" },
    { text: "." },
  ],
  id: "p2",
  type: "p",
};
// the rich blocks, each locked to typing, and the diagram Pele draws from the page's one script
const CHART_BLOCK: LibraryBlock = {
  children: [{ text: "" }],
  id: "c1",
  type: "chart_block",
  value:
    '{"type":"bar","title":"Requests","data":[{"label":"Mon","value":12},{"label":"Tue","value":18}]}',
};
const DIAGRAM_BLOCK: LibraryBlock = {
  children: [
    { children: [{ text: "graph TD;" }], type: "code_line" },
    { children: [{ text: "Draft-->Ship;" }], type: "code_line" },
  ],
  id: "m1",
  lang: "mermaid",
  type: "code_block",
};
const TABS_BLOCK: LibraryBlock = {
  children: [
    {
      children: [{ children: [{ text: TAB_TEXT }], type: "p" }],
      label: "First",
      type: "tab_panel",
    },
  ],
  id: "t1",
  type: "tab_group",
};

// an item as the phone's replica holds it, each block under the hash a write names as its base
const heldOf = (blocks: readonly LibraryBlock[]): HeldItem => ({
  blocks: blocks.map((block, index) => ({
    block,
    hash: blockHash(block),
    ord: `a${String(index)}`,
    section: "note",
  })),
  bodyHeld: true,
  fields: noteFields({ title: "Phone item" }),
});

const RICH = [CHART_BLOCK, DIAGRAM_BLOCK, TABS_BLOCK];

const ITEM = heldOf([
  paragraphBlock("p1", ITEM_PARAGRAPH),
  LINK_BLOCK,
  ...RICH,
  paragraphBlock("p3", "The last line."),
]);

// The phone's end of the bridge, run in the page as react-native-webview would host it, standing
// in for its replica and its file cache: it records every frame, answers the item it holds, the
// items a link can name, the one picture it holds, each write with the outcome the drive queued
// for it (else queued for the cell), and each highlight as queued, through the door the page
// installed, as the native end's injection does.
const PHONE_SCRIPT = `(() => {
  const nonce = ${JSON.stringify(NONCE)};
  const itemId = ${JSON.stringify(ITEM_ID)};
  const targets = ${JSON.stringify([{ id: OTHER_ID, title: "Other" }])};
  const picture = { base64: ${JSON.stringify(PICTURE_BASE64)}, mediaType: "image/png" };
  const state = { item: ${JSON.stringify(ITEM)}, outcomes: [], sent: [] };
  const answer = (request) => {
    if (request.kind === "item") {
      return { ok: true, result: { item: request.payload.itemId === itemId ? state.item : null } };
    }
    if (request.kind === "writeItem") {
      return { ok: true, result: state.outcomes.shift() ?? { kind: "queued" } };
    }
    if (request.kind === "linkTargets") {
      return { ok: true, result: { targets } };
    }
    if (request.kind === "readFile") {
      const held = request.payload.sha === ${JSON.stringify(PICTURE_SHA)};
      return { ok: true, result: { file: held ? picture : null } };
    }
    if (request.kind === "addHighlight" || request.kind === "noteHighlight") {
      return { ok: true, result: { queued: true } };
    }
    return { error: "the scripted phone does not answer " + request.kind, ok: false };
  };
  window.ReactNativeWebView = {
    postMessage: (text) => {
      const frame = JSON.parse(text);
      state.sent.push(frame);
      if (frame.type === "request") {
        setTimeout(() => {
          const reply = { ...answer(frame), id: frame.id, nonce, type: "response" };
          window[${JSON.stringify(PAGE_RECEIVER)}](JSON.stringify(reply));
        }, 0);
      }
    },
  };
  window.__phone = state;
  return "installed";
})()`;

// the phone's end of the headless page: it records what the page sends
const HEADLESS_SCRIPT = `(() => {
  const sent = [];
  window.ReactNativeWebView = { postMessage: (text) => { sent.push(JSON.parse(text)); } };
  window.__headless = { sent };
  return "installed";
})()`;

const HEADLESS_NONCE = "e2e-headless-nonce-0123456789";

// a page the phone fetched for a link it shared, as the reader is handed it
const SHARED_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  "<title>File over app</title>",
  '<meta property="og:site_name" content="Steph Ango">',
  '<meta name="description" content="Files you can control.">',
  '<meta property="og:image" content="https://stephango.com/cover.png">',
  '</head><body><nav><a href="/">Home</a> <a href="/about">About</a></nav><article>',
  "<h1>File over app</h1>",
  "<p>If you want to create digital artifacts that last, they must be <em>files</em> you can control.</p>",
  '<p>Apps are ephemeral; <a href="https://example.com/files">the files</a> outlast them.</p>',
  "<ul><li>Plain text</li><li>Open formats</li></ul>",
  "<pre><code>const file = read();</code></pre>",
  "</article><footer>© Steph Ango</footer></body></html>",
].join("\n");

const FILL_JOB: FillJob = {
  base64: Buffer.from(SHARED_PAGE, "utf-8").toString("base64"),
  charset: "utf-8",
  prefer: "article",
  url: "https://stephango.com/file-over-app",
};

// a paragraph the phone rewrote at its start while another device rewrote its end
const MERGE_SIDES: MergeSides = {
  base: paragraphBlock("q1", "One line.\nTwo lines.\nThree lines."),
  mine: paragraphBlock("q1", "One line, from the phone.\nTwo lines.\nThree lines."),
  theirs: paragraphBlock("q1", "One line.\nTwo lines.\nThree lines, from the Mac."),
};

// the reading with its block ids left out, since each reader mints its own
const withoutIds = (answer: FillAnswer | undefined) =>
  answer?.kind === "read"
    ? {
        ...answer,
        article: answer.article.map(({ block, ord }) => ({ block: { ...block, id: "" }, ord })),
      }
    : answer;

// the DOM caret the browser would leave after a tap, at the end of the text node holding `text`
// (or across `text` itself when `select` is set)
const caretScript = (text: string, select: boolean): string => `(() => {
  const editor = document.querySelector(${JSON.stringify(EDITOR)});
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = null;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.includes(${JSON.stringify(text)})) {
      node = walker.currentNode;
    }
  }
  if (node === null) {
    return "missing";
  }
  editor.focus();
  const start = node.textContent.indexOf(${JSON.stringify(text)});
  const range = document.createRange();
  range.setStart(node, ${select ? "start" : "node.textContent.length"});
  range.setEnd(node, ${select ? `start + ${String(text.length)}` : "node.textContent.length"});
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return "placed";
})()`;

// the drawing Pele answers, under the page's own CSP and from the one inlined script
const DIAGRAM_LABELS = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${EDITOR} svg.pele text`)})].map((text) => text.textContent))`;

// the note's picture's width once it decoded from an object URL of the page's, else -1
const PICTURE_DRAWN = `String((() => { const img = document.querySelector(${JSON.stringify(`${EDITOR} img[alt="A pixel"]`)}); return img !== null && img.src.startsWith("blob:") ? img.naturalWidth : -1; })())`;

// the phone asks the agent from the item's own screen, so a selection offers no Ask agent
const NO_ASK_AGENT = `String(document.querySelector('button[aria-label="Ask agent"]') === null)`;

type WriteItemFrame = Extract<PageFrame, { kind: "writeItem"; type: "request" }>;

const isWriteItem = (frame: PageFrame): frame is WriteItemFrame =>
  frame.type === "request" && frame.kind === "writeItem";

const isItemRead = (frame: PageFrame): boolean => frame.type === "request" && frame.kind === "item";

const phoneOf = (browser: ScenarioBrowser) => {
  const sent = async (): Promise<PageFrame[]> =>
    parseEval(
      await browser(["eval", "JSON.stringify(window.__phone.sent)"]),
      z.array(pageFrameSchema),
    );
  const writes = async (): Promise<WriteItemFrame[]> => {
    const frames = await sent();
    return frames.filter(isWriteItem);
  };
  return {
    buffer: async (): Promise<string> => await browser(["get", "text", EDITOR]),
    inject: async (frame: NativeFrame): Promise<void> => {
      await browser(["eval", nativeFrameScript(frame)]);
    },
    // the phone's replica answers the page's next write with this
    queueOutcome: async (outcome: ItemOutcome): Promise<void> => {
      await browser(["eval", `window.__phone.outcomes.push(${JSON.stringify(outcome)}); "set"`]);
    },
    readCount: async (): Promise<number> => {
      const frames = await sent();
      return frames.filter(isItemRead).length;
    },
    // the phone's replica moves, and the page is told nothing
    replace: async (item: HeldItem): Promise<void> => {
      await browser(["eval", `window.__phone.item = ${JSON.stringify(item)}; "set"`]);
    },
    sent,
    writes,
    writesAtLeast: async (count: number, what: string): Promise<WriteItemFrame[]> =>
      await pollUntil(writes, (frames) => frames.length >= count, {
        deadlineMs: 15_000,
        describe: (frames) => `${what}: ${String(frames.length)} write(s) reached the phone`,
      }),
  };
};

type Phone = ReturnType<typeof phoneOf>;

const typeAt = async (browser: ScenarioBrowser, text: string, typed: string): Promise<void> => {
  expectEq(
    parseEval(await browser(["eval", caretScript(text, false)]), z.string()),
    "placed",
    `the caret could not be placed after "${text}"`,
  );
  await browser(["keyboard", "type", typed]);
};

const expectNoWriteAfter = async (phone: Phone, what: string, before: number): Promise<void> => {
  await delay(SETTLE_MS);
  const writes = await phone.writes();
  expect(
    writes.length === before,
    `${what} changed the item: the page wrote ${JSON.stringify(
      writes.slice(before).map((frame) => frame.payload.ops),
    )}`,
  );
};

// the page loaded with nothing open, its door installed and waiting for its init
const openPage = async (browser: ScenarioBrowser, page: string): Promise<void> => {
  await browser(["open", page]);
  await pollUntil(
    async () =>
      parseEval(
        await browser(["eval", `typeof window[${JSON.stringify(PAGE_RECEIVER)}]`]),
        z.string(),
      ),
    (kind) => kind === "function",
    {
      deadlineMs: 15_000,
      describe: (kind) =>
        `the page's script never ran from file:// (the door is ${kind}); a module script or a crossorigin tag is refused there`,
    },
  );
};

// the item's editor over a scripted replica: it draws the item, its link by the name its item
// goes by now and its diagram; typing on a locked block writes nothing; a pause writes the one
// block typed in as a put under the hash the phone gave it; a nonce-less frame is ignored; an
// announced change is laid in; a write the phone finds changed is written again over what it
// holds; a flush is answered; and a link opens the item it names by id
const driveItem = async (
  browser: ScenarioBrowser,
  page: string,
  log: (line: string) => void,
): Promise<void> => {
  log("the page reads the item the phone's replica holds");
  await openPage(browser, page);
  await browser(["eval", PHONE_SCRIPT]);
  const phone = phoneOf(browser);
  await phone.inject({
    fileMaxBytes: 100 * 1024 * 1024,
    focus: null,
    itemId: ITEM_ID,
    mode: "item",
    nonce: NONCE,
    type: "init",
  });
  await browser(["wait", EDITOR], 30_000);
  await pollUntil(
    phone.buffer,
    (text) => text.includes(ITEM_PARAGRAPH) && text.includes("Other") && !text.includes("Old name"),
    {
      deadlineMs: 15_000,
      describe: (text) => `the item never drew with its link's name as it is now:\n${text}`,
    },
  );
  await pollUntil(
    async () => parseEval(await browser(["eval", DIAGRAM_LABELS]), z.array(z.string())),
    (labels) => labels.includes("Draft") && labels.includes("Ship"),
    {
      deadlineMs: 15_000,
      describe: (labels) =>
        `the item's diagram never drew: its labels are ${JSON.stringify(labels)}`,
    },
  );
  await expectNoWriteAfter(phone, "opening the item", 0);

  // a tap leaves the caret in a locked block's text; the typed paragraph's exact ops below also
  // catch a keystroke held back here and landed there
  log("typing in the tab panel and on the chart writes nothing");
  await browser(["click", `${EDITOR} [data-tab-panel]`]);
  await browser(["keyboard", "type", " locked"]);
  await expectNoWriteAfter(phone, "typing in the tab panel", 0);
  await browser(["click", `${EDITOR} svg[role="img"]`]);
  await browser(["keyboard", "type", " locked"]);
  await expectNoWriteAfter(phone, "typing on the chart", 0);

  log("a pause after typing writes the paragraph as one put under its hash");
  await typeAt(browser, ITEM_PARAGRAPH, " Typed.");
  const [first] = await phone.writesAtLeast(1, "the typed paragraph");
  expect(first !== undefined, "the typed paragraph wrote nothing");
  expectEq(first.payload.itemId, ITEM_ID, "the item the write named");
  expectEq(
    first.payload.ops,
    [{ baseHash: blockHash(paragraphBlock("p1", ITEM_PARAGRAPH)), block: TYPED_BLOCK, op: "put" }],
    "the ops the typed paragraph wrote",
  );

  log("a frame with no nonce is ignored");
  const forged = heldOf([TYPED_BLOCK, LINK_BLOCK, ...RICH, paragraphBlock("p3", "FORGED")]);
  await phone.replace(forged);
  const readsBefore = await phone.readCount();
  await browser([
    "eval",
    `window[${JSON.stringify(PAGE_RECEIVER)}](${JSON.stringify(
      JSON.stringify({ ids: [ITEM_ID], overlapped: [], reset: false, type: "itemChanged" }),
    )}); "sent"`,
  ]);
  await delay(SETTLE_MS);
  expectEq(await phone.readCount(), readsBefore, "reads the forged change asked for");
  const unforged = await phone.buffer();
  expect(!unforged.includes("FORGED"), "a nonce-less frame reloaded the item");

  log("a change the phone announces is laid into the editor, its picture read from the phone");
  const fromMac = heldOf([
    TYPED_BLOCK,
    LINK_BLOCK,
    ...RICH,
    PICTURE_BLOCK,
    paragraphBlock("p3", "The last line, from the Mac."),
  ]);
  await phone.replace(fromMac);
  await phone.inject({
    ids: [ITEM_ID],
    nonce: NONCE,
    overlapped: [],
    reset: false,
    type: "itemChanged",
  });
  await pollUntil(phone.buffer, (text) => text.includes("from the Mac."), {
    deadlineMs: 15_000,
    describe: (text) => `the announced change never reached the editor:\n${text}`,
  });
  await pollUntil(
    async () => parseEval(await browser(["eval", PICTURE_DRAWN]), z.string()),
    (width) => width === "1",
    {
      deadlineMs: 15_000,
      describe: (width) => `the note's picture never drew from the phone's file: width ${width}`,
    },
  );

  log("a write the phone finds changed is written again over the item it holds now");
  const added = heldOf([
    ...fromMac.blocks.map(({ block }) => block),
    paragraphBlock("p4", "A line the Mac added."),
  ]);
  await phone.replace(added);
  await phone.queueOutcome({ item: added, kind: "changed" });
  const { length: writesBefore } = await phone.writes();
  await typeAt(browser, `${ITEM_PARAGRAPH} Typed.`, " Again.");
  const writes = await phone.writesAtLeast(writesBefore + 2, "the settled write");
  expectEq(
    writes[writesBefore + 1]?.payload.ops,
    [
      {
        baseHash: blockHash(TYPED_BLOCK),
        block: paragraphBlock("p1", `${ITEM_PARAGRAPH} Typed. Again.`),
        op: "put",
      },
    ],
    "the ops written over the item the phone holds now",
  );
  await pollUntil(phone.buffer, (text) => text.includes("A line the Mac added."), {
    deadlineMs: 15_000,
    describe: (text) => `the editor never showed the block the Mac added:\n${text}`,
  });

  log("a selection offers no Ask agent: the phone asks from the item's own screen");
  expectEq(
    parseEval(await browser(["eval", caretScript("paragraph", true)]), z.string()),
    "placed",
    "the selection could not be made",
  );
  expectEq(
    parseEval(await browser(["eval", NO_ASK_AGENT]), z.string()),
    "true",
    "the toolbar drew Ask agent",
  );

  log("a flush is answered once the item is written");
  await phone.inject({ id: 9, nonce: NONCE, type: "flush" });
  await pollUntil(
    phone.sent,
    (frames) => frames.some((frame) => frame.type === "flushed" && frame.id === 9 && frame.ok),
    {
      deadlineMs: 10_000,
      describe: (frames) =>
        `the flush was never answered ok: ${JSON.stringify(frames.filter((frame) => frame.type === "flushed"))}`,
    },
  );

  log("a link tap asks the native stack to open the item it names by id");
  await browser(["find", "role", "button", "click", "--name", "Other", "--exact"]);
  await pollUntil(
    phone.sent,
    (frames) => frames.some((frame) => frame.type === "openItem" && frame.itemId === OTHER_ID),
    {
      deadlineMs: 10_000,
      describe: (frames) =>
        `the tap never emitted openItem: ${JSON.stringify(frames.map((frame) => frame.type))}`,
    },
  );
};

// the headless page: a shared page read as linkedom reads it under node, and a block two devices
// changed merged as the editor's merge does, with nothing drawn
const driveHeadless = async (
  browser: ScenarioBrowser,
  page: string,
  log: (line: string) => void,
): Promise<void> => {
  log("loaded again headless, the page reads a shared page as linkedom does");
  await openPage(browser, page);
  await browser(["eval", HEADLESS_SCRIPT]);
  await browser([
    "eval",
    nativeFrameScript({ mode: "headless", nonce: HEADLESS_NONCE, type: "init" }),
  ]);
  await browser([
    "eval",
    nativeFrameScript({ id: 7, job: FILL_JOB, nonce: HEADLESS_NONCE, type: "fillJob" }),
  ]);
  await browser([
    "eval",
    nativeFrameScript({ id: 8, nonce: HEADLESS_NONCE, sides: MERGE_SIDES, type: "mergeJob" }),
  ]);
  const answered = await pollUntil(
    async () =>
      parseEval(
        await browser(["eval", "JSON.stringify(window.__headless.sent)"]),
        z.array(pageFrameSchema),
      ),
    (frames) =>
      frames.some((frame) => frame.type === "fillAnswer") &&
      frames.some((frame) => frame.type === "mergeAnswer"),
    {
      deadlineMs: 15_000,
      describe: (frames) =>
        `the headless page never answered both: ${JSON.stringify(frames.map((frame) => frame.type))}`,
    },
  );
  const fill = answered.find((frame) => frame.type === "fillAnswer");
  expect(
    fill?.type === "fillAnswer" && fill.id === 7 && fill.nonce === HEADLESS_NONCE,
    `the reader's answer: ${JSON.stringify(fill)}`,
  );
  expectEq(
    withoutIds(fill.answer),
    withoutIds(readPage(FILL_JOB, parsePage)),
    "the page's reading against linkedom's",
  );
  expect(
    fill.answer.kind === "read" &&
      fill.answer.article.length > 0 &&
      fill.answer.facts.title === "File over app",
    `the reader read the article: ${JSON.stringify(fill.answer)}`,
  );

  log("and merges a block both devices changed as the editor's merge does");
  const merge = answered.find((frame) => frame.type === "mergeAnswer");
  expect(
    merge?.type === "mergeAnswer" && merge.id === 8,
    `the merge's answer: ${JSON.stringify(merge)}`,
  );
  // as the wire carries each: a key the node merge leaves undefined is no key on the wire
  expectEq(
    JSON.stringify(merge.merged),
    JSON.stringify(mergeSides(MERGE_SIDES)),
    "the page's merge against the editor's under node",
  );
  expectEq(merge.merged?.overlapped, false, "two changes to two lines do not overlap");
  const drawn = await browser(["get", "text", "body"]);
  expect(!drawn.includes("File over app"), "the headless page drew the page it read");
};

export const phoneEditorPage: Scenario = {
  description:
    "the phone's editor page, built through turbo, loads from `file://` at 390×844 with a scripted phone on its bridge: an item draws its link by the name its item goes by now and its diagram from the one inlined script, typing on a locked block writes nothing, a pause writes the typed block as one put under the hash the phone gave it, a nonce-less frame is ignored, an announced change is laid in, a write the phone finds changed is written again over what it holds, a selection offers no Ask agent, a flush is answered and a link opens its item by id; headless, the page reads a shared page as linkedom does and merges a block as the editor's merge does under node",
  name: "phone-editor-page",
  // the build's own budget plus the drive
  timeoutMs: BUILD_TIMEOUT_MS + 120_000,
  async run(ctx) {
    // built through turbo, not looked for on disk: a present dist/ may be last week's page.
    await turboBuildOnce({
      filter: "@repo/mobile-editor",
      onLog: ctx.log,
      repoRoot: ctx.repoRoot,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    const page = pathToFileURL(
      path.join(ctx.repoRoot, "apps", "mobile-editor", "dist", "index.html"),
    ).href;
    const browser = await ctx.browser("phone-editor");
    await browser(["set", "viewport", "390", "844"]);
    ctx.log(`opening ${page}`);
    await driveItem(browser, page, ctx.log);
    await driveHeadless(browser, page, ctx.log);
  },
};
