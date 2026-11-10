// The phone's editor page, built as the app carries it and loaded from `file://` with a scripted
// phone on its bridge: an item drawn read-only from the blocks the phone holds, drawn again as the
// item moves, its links opening on the native stack.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

import { nativeFrameScript, PAGE_RECEIVER, pageFrameSchema } from "@repo/editor-bridge/protocol";
import type { NativeFrame, PageFrame, RequestResult } from "@repo/editor-bridge/protocol";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { noteFields } from "@repo/contract/test-support/library-items";

import { parseEval } from "../harness/agent-browser";
import type { ScenarioBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";
import { turboBuildOnce } from "../harness/turbo-build";

// a cold vite build of the page, pele and katex inlined; a cached one returns at once.
const BUILD_TIMEOUT_MS = 300_000;

// long enough for a frame the page should ignore to have been read
const SETTLE_MS = 2000;

const NONCE = "e2e-item-nonce-0123456789";
const ITEM_ID = "0190a000-0000-7000-8000-0000000000e2";
// the item the link names by its id, which went by another name when the link was written
const OTHER_ID = "0190a000-0000-7000-8000-0000000000e3";
const ITEM_PARAGRAPH = "An item's paragraph to type into.";
// the page's own words for why the text takes no edit (apps/mobile-editor/src/item/item-page.tsx)
const READS_ONLY = "Editing on the phone is coming.";
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

type HeldItem = NonNullable<RequestResult<"item">["item"]>;

const paragraphBlock = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const LINK_BLOCK: LibraryBlock = {
  children: [
    { text: "See " },
    { children: [{ text: "" }], key: OTHER_ID, type: "mention", value: "Old name" },
    { text: "." },
  ],
  id: "p2",
  type: "p",
};
// the diagram Pele draws from the page's one script
const DIAGRAM_BLOCK: LibraryBlock = {
  children: [
    { children: [{ text: "graph TD;" }], type: "code_line" },
    { children: [{ text: "Draft-->Ship;" }], type: "code_line" },
  ],
  id: "m1",
  lang: "mermaid",
  type: "code_block",
};

// an item as the library holds it, its blocks in reading order
const heldOf = (blocks: readonly LibraryBlock[]): HeldItem => ({
  blocks: blocks.map((block) => ({ block, section: "note" })),
  fields: noteFields({ title: "Phone item" }),
});

const ITEM = heldOf([
  paragraphBlock("p1", ITEM_PARAGRAPH),
  LINK_BLOCK,
  DIAGRAM_BLOCK,
  paragraphBlock("p3", "The last line."),
]);

// The phone's end of the bridge, run in the page as react-native-webview would host it, standing
// in for the library and its file cache: it records every frame and answers the item it holds,
// the items a link can name and the one picture it holds, through the door the page installed, as
// the native end's injection does.
const PHONE_SCRIPT = `(() => {
  const nonce = ${JSON.stringify(NONCE)};
  const itemId = ${JSON.stringify(ITEM_ID)};
  const targets = ${JSON.stringify([{ id: OTHER_ID, title: "Other" }])};
  const picture = { base64: ${JSON.stringify(PICTURE_BASE64)}, mediaType: "image/png" };
  const state = { item: ${JSON.stringify(ITEM)}, sent: [] };
  const answer = (request) => {
    if (request.kind === "item") {
      return { ok: true, result: { item: request.payload.itemId === itemId ? state.item : null } };
    }
    if (request.kind === "linkTargets") {
      return { ok: true, result: { targets } };
    }
    if (request.kind === "readFile") {
      const held = request.payload.sha === ${JSON.stringify(PICTURE_SHA)};
      return { ok: true, result: { file: held ? picture : null } };
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

// whether the editor takes typing: Plate's read-only editor is not contenteditable
const editable = async (browser: ScenarioBrowser): Promise<string> =>
  await browser(["get", "attr", EDITOR, "contenteditable"]);

// the phone asks the agent from the item's own screen, so a selection offers no Ask agent
const NO_ASK_AGENT = `String(document.querySelector('button[aria-label="Ask agent"]') === null)`;

const isItemRead = (frame: PageFrame): boolean => frame.type === "request" && frame.kind === "item";

const phoneOf = (browser: ScenarioBrowser) => {
  const sent = async (): Promise<PageFrame[]> =>
    parseEval(
      await browser(["eval", "JSON.stringify(window.__phone.sent)"]),
      z.array(pageFrameSchema),
    );
  return {
    buffer: async (): Promise<string> => await browser(["get", "text", EDITOR]),
    inject: async (frame: NativeFrame): Promise<void> => {
      await browser(["eval", nativeFrameScript(frame)]);
    },
    readCount: async (): Promise<number> => {
      const frames = await sent();
      return frames.filter(isItemRead).length;
    },
    // the library moves, and the page is told nothing
    replace: async (item: HeldItem): Promise<void> => {
      await browser(["eval", `window.__phone.item = ${JSON.stringify(item)}; "set"`]);
    },
    sent,
  };
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

// the item over a scripted phone: it draws the item read-only under the page's words, its link by
// the name its item goes by now and its diagram; typing changes nothing; a nonce-less frame is
// ignored; an announced change is drawn, its picture read from the phone; and a link opens the
// item it names by id
const driveItem = async (
  browser: ScenarioBrowser,
  page: string,
  log: (line: string) => void,
): Promise<void> => {
  log("the page reads the item the phone holds, and draws it read-only");
  await openPage(browser, page);
  await browser(["eval", PHONE_SCRIPT]);
  const phone = phoneOf(browser);
  await phone.inject({ itemId: ITEM_ID, nonce: NONCE, type: "init" });
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
  const main = await browser(["get", "text", "main"]);
  expect(main.includes(READS_ONLY), `the page never said why it takes no edit:\n${main}`);
  expectEq(await editable(browser), "false", "the item's editor");

  log("typing changes nothing");
  const before = await phone.buffer();
  expectEq(
    parseEval(await browser(["eval", caretScript(ITEM_PARAGRAPH, false)]), z.string()),
    "placed",
    `the caret could not be placed after "${ITEM_PARAGRAPH}"`,
  );
  await browser(["keyboard", "type", " Typed."]);
  await delay(SETTLE_MS);
  expectEq(await phone.buffer(), before, "the item's text after typing");

  log("a frame with no nonce is ignored");
  await phone.replace(
    heldOf([...ITEM.blocks.map(({ block }) => block), paragraphBlock("p4", "FORGED")]),
  );
  const readsBefore = await phone.readCount();
  await browser([
    "eval",
    `window[${JSON.stringify(PAGE_RECEIVER)}](${JSON.stringify(
      JSON.stringify({ ids: [ITEM_ID], reset: false, type: "itemChanged" }),
    )}); "sent"`,
  ]);
  await delay(SETTLE_MS);
  expectEq(await phone.readCount(), readsBefore, "reads the forged change asked for");
  const unforged = await phone.buffer();
  expect(!unforged.includes("FORGED"), "a nonce-less frame reloaded the item");

  log("a change the phone announces is drawn, its picture read from the phone");
  await phone.replace(
    heldOf([
      paragraphBlock("p1", ITEM_PARAGRAPH),
      LINK_BLOCK,
      DIAGRAM_BLOCK,
      PICTURE_BLOCK,
      paragraphBlock("p3", "The last line, from the Mac."),
    ]),
  );
  await phone.inject({ ids: [ITEM_ID], nonce: NONCE, reset: false, type: "itemChanged" });
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

export const phoneEditorPage: Scenario = {
  description:
    "the phone's editor page, built through turbo, loads from `file://` at 390×844 with a scripted phone on its bridge: an item draws read-only under the page's words for why, its link by the name its item goes by now and its diagram from the one inlined script, typing changes nothing, a nonce-less frame is ignored, an announced change is drawn with its picture from the phone, a selection offers no Ask agent, and a link opens its item by id",
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
  },
};
