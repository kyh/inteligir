import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

import { nativeFrameScript, PAGE_RECEIVER, pageFrameSchema } from "@repo/editor-bridge/protocol";
import type { FillJob, NativeFrame, PageFrame, RequestResult } from "@repo/editor-bridge/protocol";
import { readPage } from "@repo/mobile-editor/reader-mode";
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

const NONCE = "e2e-phone-nonce-0123456789";
const NOTE_PATH = "Phone.md";
const OTHER_PATH = "Other.md";
const DOT_PATH = "assets/dot.png";
// one pixel, so the image round trip needs no fixture file
const DOT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const PARAGRAPH = "A paragraph to type into.";
const TAB_TEXT = "Tab text.";

// canonical, so a save of it changes only what was typed
const NOTE = [
  "# Phone",
  "",
  PARAGRAPH,
  "",
  "```inteligir-chart",
  '{"type":"bar","title":"Requests","data":[{"label":"Mon","value":12},{"label":"Tue","value":18}]}',
  "```",
  "",
  "```mermaid",
  "graph TD;",
  "Draft-->Ship;",
  "```",
  "",
  ":::tabs",
  "=== First",
  TAB_TEXT,
  ":::",
  "",
  `![A dot](${DOT_PATH})`,
  "",
  "See [[Other]].",
  "",
].join("\n");

// past the serialize debounce and the autosave behind it
const SETTLE_MS = 2000;

const READER_NONCE = "e2e-reader-nonce-0123456789";

// a page the phone fetched for a link it saved, as the reader is handed it
const READER_PAGE = [
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

const READER_JOB: FillJob = {
  base64: Buffer.from(READER_PAGE, "utf-8").toString("base64"),
  charset: "utf-8",
  prefer: "article",
  url: "https://stephango.com/file-over-app",
};

const ITEM_NONCE = "e2e-item-nonce-0123456789";
const ITEM_ID = "0190a000-0000-7000-8000-0000000000e2";
// the item the link names by its id, which went by another name when the link was written
const OTHER_ID = "0190a000-0000-7000-8000-0000000000e3";
const ITEM_PARAGRAPH = "An item's paragraph to type into.";

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

const ITEM = heldOf([
  paragraphBlock("p1", ITEM_PARAGRAPH),
  LINK_BLOCK,
  paragraphBlock("p3", "The last line."),
]);

// The phone's end of the bridge in item mode, standing in for its replica: it answers the item it
// holds, the items a link can name, and each write with the outcome the drive queued for it, or
// queued for the cell.
const ITEM_PHONE_SCRIPT = `(() => {
  const nonce = ${JSON.stringify(ITEM_NONCE)};
  const itemId = ${JSON.stringify(ITEM_ID)};
  const targets = ${JSON.stringify([{ id: OTHER_ID, path: OTHER_PATH, title: "Other", type: "doc" }])};
  const state = { item: ${JSON.stringify(ITEM)}, outcomes: [], sent: [] };
  const answer = (request) => {
    if (request.kind === "item") {
      return { ok: true, result: { item: request.payload.itemId === itemId ? state.item : null } };
    }
    if (request.kind === "writeItem") {
      return { ok: true, result: state.outcomes.shift() ?? { kind: "queued" } };
    }
    if (request.kind === "wikiTargets") {
      return { ok: true, result: { targets } };
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
  window.__itemPhone = state;
  return "installed";
})()`;

// the phone's end of the reader mode: it records what the page sends
const READER_PHONE_SCRIPT = `(() => {
  const sent = [];
  window.ReactNativeWebView = { postMessage: (text) => { sent.push(JSON.parse(text)); } };
  window.__reader = { sent };
  return "installed";
})()`;

// the phone asks no agent, so a selection offers no Ask agent
const NO_ASK_AGENT = `String(document.querySelector('button[aria-label="Ask agent"]') === null)`;

// The phone's end of the bridge, run in the page as react-native-webview would host it: it
// records every frame, answers each request from its own files, and answers through the door
// the page installed, as the native end's injection does. A write is compared with its base.
const PHONE_SCRIPT = `(() => {
  const files = ${JSON.stringify({ [NOTE_PATH]: NOTE, [OTHER_PATH]: "Other note.\n" })};
  const assets = ${JSON.stringify({ [DOT_PATH]: { base64: DOT_PNG, mediaType: "image/png" } })};
  const nonce = ${JSON.stringify(NONCE)};
  const sent = [];
  const answer = (request) => {
    const payload = request.payload;
    if (request.kind === "list") {
      return { ok: true, result: { paths: [...Object.keys(files), ...Object.keys(assets)] } };
    }
    if (request.kind === "read") {
      return payload.path in files
        ? { ok: true, result: { content: files[payload.path] } }
        : { error: "no " + payload.path, ok: false };
    }
    if (request.kind === "readAsset") {
      return payload.path in assets
        ? { ok: true, result: assets[payload.path] }
        : { error: "no " + payload.path, ok: false };
    }
    if (request.kind === "wikiTargets") {
      const targets = Object.keys(files).map((path) => ({ path, title: path.replace(/\\.md$/u, ""), type: "doc" }));
      return { ok: true, result: { targets } };
    }
    if (request.kind === "write") {
      const current = files[payload.path];
      if (payload.guard.kind === "absent") {
        if (current !== undefined) {
          return { ok: true, result: { kind: "exists" } };
        }
      } else if (current === undefined) {
        return { ok: true, result: { kind: "missing" } };
      } else if (current !== payload.guard.base) {
        return { ok: true, result: { current, kind: "changed" } };
      }
      files[payload.path] = payload.content;
      return { ok: true, result: { kind: "written" } };
    }
    return { error: "the scripted phone does not answer " + request.kind, ok: false };
  };
  window.ReactNativeWebView = {
    postMessage: (text) => {
      const frame = JSON.parse(text);
      sent.push(frame);
      if (frame.type === "request") {
        setTimeout(() => {
          const reply = { ...answer(frame), id: frame.id, nonce, type: "response" };
          window[${JSON.stringify(PAGE_RECEIVER)}](JSON.stringify(reply));
        }, 0);
      }
    },
  };
  window.__phone = { files, sent };
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

const IMAGE_LOADED = `(() => {
  const image = document.querySelector(${JSON.stringify(`${EDITOR} img[alt="A dot"]`)});
  return String(image !== null && image.complete && image.naturalWidth > 0 && image.src.startsWith("blob:"));
})()`;

// the drawing Pele answers, under the page's own CSP and from the one inlined script
const DIAGRAM_LABELS = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${EDITOR} svg.pele text`)})].map((text) => text.textContent))`;

type WriteFrame = Extract<PageFrame, { kind: "write"; type: "request" }>;

const isWrite = (frame: PageFrame): frame is WriteFrame =>
  frame.type === "request" && frame.kind === "write";

const isRead = (frame: PageFrame): boolean => frame.type === "request" && frame.kind === "read";

const phoneOf = (browser: ScenarioBrowser) => {
  const sent = async (): Promise<PageFrame[]> =>
    parseEval(
      await browser(["eval", "JSON.stringify(window.__phone.sent)"]),
      z.array(pageFrameSchema),
    );
  return {
    buffer: async (): Promise<string> => await browser(["get", "text", EDITOR]),
    readCount: async (): Promise<number> => {
      const frames = await sent();
      return frames.filter(isRead).length;
    },
    inject: async (frame: NativeFrame): Promise<void> => {
      await browser(["eval", nativeFrameScript(frame)]);
    },
    // the phone's own copy moves, and the page is told nothing
    replace: async (content: string): Promise<void> => {
      await browser([
        "eval",
        `window.__phone.files[${JSON.stringify(NOTE_PATH)}] = ${JSON.stringify(content)}; "set"`,
      ]);
    },
    sent,
    writes: async (): Promise<WriteFrame[]> => {
      const frames = await sent();
      return frames.filter(isWrite);
    },
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
    `${what} changed the note: the page wrote\n${writes
      .slice(before)
      .map((frame) => frame.payload.content)
      .join("\n---\n")}`,
  );
};

const lastWrite = async (phone: Phone, count: number, what: string): Promise<WriteFrame> => {
  const writes = await pollUntil(phone.writes, (frames) => frames.length >= count, {
    deadlineMs: 15_000,
    describe: (frames) => `${what}: ${String(frames.length)} write(s) reached the phone`,
  });
  const last = writes.at(-1);
  expect(last !== undefined, `${what}: no write reached the phone`);
  return last;
};

type WriteItemFrame = Extract<PageFrame, { kind: "writeItem"; type: "request" }>;

const isWriteItem = (frame: PageFrame): frame is WriteItemFrame =>
  frame.type === "request" && frame.kind === "writeItem";

const itemPhoneOf = (browser: ScenarioBrowser) => {
  const sent = async (): Promise<PageFrame[]> =>
    parseEval(
      await browser(["eval", "JSON.stringify(window.__itemPhone.sent)"]),
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
      await browser([
        "eval",
        `window.__itemPhone.outcomes.push(${JSON.stringify(outcome)}); "set"`,
      ]);
    },
    // the phone's replica moves, and the page is told nothing
    replace: async (item: HeldItem): Promise<void> => {
      await browser(["eval", `window.__itemPhone.item = ${JSON.stringify(item)}; "set"`]);
    },
    sent,
    writesAtLeast: async (count: number, what: string): Promise<WriteItemFrame[]> =>
      await pollUntil(writes, (frames) => frames.length >= count, {
        deadlineMs: 15_000,
        describe: (frames) => `${what}: ${String(frames.length)} write(s) reached the phone`,
      }),
  };
};

// the page loaded again with nothing open, waiting for its init
const reopenPage = async (browser: ScenarioBrowser, page: string): Promise<void> => {
  await browser(["open", page]);
  await pollUntil(
    async () =>
      parseEval(
        await browser(["eval", `typeof window[${JSON.stringify(PAGE_RECEIVER)}]`]),
        z.string(),
      ),
    (kind) => kind === "function",
    { deadlineMs: 15_000, describe: (kind) => `the reloaded page's door is ${kind}` },
  );
};

// the page in item mode, over a scripted replica: a pause writes the one block typed in as a put
// under the hash the phone gave it, an announced change is laid in, a write the phone finds
// changed is written again over what it holds, a flush is answered, and a link shows and opens
// the item it names by id
const driveItemMode = async (
  browser: ScenarioBrowser,
  page: string,
  log: (line: string) => void,
): Promise<void> => {
  log("loaded again in item mode, the page reads the item the phone's replica holds");
  await reopenPage(browser, page);
  await browser(["eval", ITEM_PHONE_SCRIPT]);
  const phone = itemPhoneOf(browser);
  await phone.inject({
    focus: null,
    itemId: ITEM_ID,
    mode: "item",
    nonce: ITEM_NONCE,
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

  log("a change the phone announces is laid into the editor");
  const fromMac = heldOf([
    TYPED_BLOCK,
    LINK_BLOCK,
    paragraphBlock("p3", "The last line, from the Mac."),
  ]);
  await phone.replace(fromMac);
  await phone.inject({
    ids: [ITEM_ID],
    nonce: ITEM_NONCE,
    overlapped: [],
    reset: false,
    type: "itemChanged",
  });
  await pollUntil(phone.buffer, (text) => text.includes("from the Mac."), {
    deadlineMs: 15_000,
    describe: (text) => `the announced change never reached the editor:\n${text}`,
  });

  log("a write the phone finds changed is written again over the item it holds now");
  const added = heldOf([
    ...fromMac.blocks.map(({ block }) => block),
    paragraphBlock("p4", "A line the Mac added."),
  ]);
  await phone.replace(added);
  await phone.queueOutcome({ item: added, kind: "changed" });
  const { length: writesBefore } = await phone.writesAtLeast(1, "the writes so far");
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

  log("a flush is answered once the item is written");
  await phone.inject({ id: 9, nonce: ITEM_NONCE, type: "flush" });
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

export const phoneEditorPage: Scenario = {
  description:
    "the phone's editor page, built through turbo, loads from `file://` at 390×844 with a scripted phone on its bridge: a typed paragraph writes exactly the note's new bytes under its read base, typing in a tab panel or on a chart writes nothing, a nonce-less frame is ignored, an announced change reloads the buffer, a write the phone finds changed lands merged and shows, a selection offers no Ask agent, a wiki link tap reaches the native end; in item mode a pause writes the typed block as one put under the hash the phone gave it, an announced change is laid in, a write the phone finds changed is written again over what it holds, and a link shows the name its item goes by now and opens it by id; and in reader mode the page reads a saved link exactly as linkedom does",
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
    await browser(["open", page]);

    ctx.log("the page loads from file://: its one classic script ran and installed the door");
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

    const phone = phoneOf(browser);
    await browser(["eval", PHONE_SCRIPT]);
    await phone.inject({
      focus: null,
      mode: "edit",
      nonce: NONCE,
      path: NOTE_PATH,
      type: "init",
    });
    await browser(["wait", EDITOR], 30_000);
    await pollUntil(
      async () => parseEval(await browser(["eval", IMAGE_LOADED]), z.string()),
      (loaded) => loaded === "true",
      {
        deadlineMs: 15_000,
        describe: () => "the note's image never drew from the bytes the phone sent",
      },
    );
    await pollUntil(
      async () => parseEval(await browser(["eval", DIAGRAM_LABELS]), z.array(z.string())),
      (labels) => labels.includes("Draft") && labels.includes("Ship"),
      {
        deadlineMs: 15_000,
        describe: (labels) =>
          `the note's diagram never drew: its labels are ${JSON.stringify(labels)}`,
      },
    );
    const booted = await phone.sent();
    const opened = booted.filter((frame) => frame.type === "opened");
    expect(
      opened.some((frame) => frame.path === NOTE_PATH && frame.nonce === NONCE),
      `the page never said ${NOTE_PATH} was open: ${JSON.stringify(opened)}`,
    );

    // a tap leaves the caret in a locked block's text; the paragraph's exact bytes below also
    // catch a keystroke held back here and landed there
    ctx.log("typing in the tab panel and on the chart changes nothing");
    await browser(["click", `${EDITOR} [data-tab-panel]`]);
    await browser(["keyboard", "type", " locked"]);
    await expectNoWriteAfter(phone, "typing in the tab panel", 0);
    await browser(["click", `${EDITOR} svg[role="img"]`]);
    await browser(["keyboard", "type", " locked"]);
    await expectNoWriteAfter(phone, "typing on the chart", 0);

    ctx.log("typing in a paragraph lands exactly the bytes the note now holds");
    await typeAt(browser, PARAGRAPH, " Typed.");
    const typed = NOTE.replace(PARAGRAPH, `${PARAGRAPH} Typed.`);
    const first = await lastWrite(phone, 1, "the typed paragraph");
    expectEq(first.payload.content, typed, "the bytes the typed paragraph wrote");
    expect(
      first.payload.guard.kind === "expected" && first.payload.guard.base === NOTE,
      `the write was not guarded by the text the page read: ${JSON.stringify(first.payload.guard)}`,
    );

    ctx.log("a frame with no nonce is ignored");
    const forged = typed.replace("See [[Other]].", "See [[Other]]. FORGED");
    await phone.replace(forged);
    const readsBefore = await phone.readCount();
    await browser([
      "eval",
      `window[${JSON.stringify(PAGE_RECEIVER)}](${JSON.stringify(
        JSON.stringify({ event: { kind: "content", path: NOTE_PATH }, type: "vaultChanged" }),
      )}); "sent"`,
    ]);
    await delay(SETTLE_MS);
    expectEq(await phone.readCount(), readsBefore, "reads the forged change asked for");
    const unforged = await phone.buffer();
    expect(!unforged.includes("FORGED"), "a nonce-less frame reloaded the note");
    await phone.replace(typed);

    ctx.log("a change the phone announces reloads the buffer");
    const fromMac = `${typed}\nAdded on the Mac.\n`;
    await phone.replace(fromMac);
    await phone.inject({
      event: { kind: "content", path: NOTE_PATH },
      nonce: NONCE,
      type: "vaultChanged",
    });
    await pollUntil(phone.buffer, (text) => text.includes("Added on the Mac."), {
      deadlineMs: 15_000,
      describe: (text) => `the announced change never reached the buffer:\n${text}`,
    });

    ctx.log("a write the phone finds changed is merged, and the buffer shows the merge");
    const elsewhere = fromMac.replace("See [[Other]].", "See [[Other]] soon.");
    await phone.replace(elsewhere);
    const { length: writesBefore } = await phone.writes();
    await typeAt(browser, `${PARAGRAPH} Typed.`, " Again.");
    const merged = elsewhere.replace(`${PARAGRAPH} Typed.`, `${PARAGRAPH} Typed. Again.`);
    const retry = await lastWrite(phone, writesBefore + 2, "the merged save");
    expectEq(retry.payload.content, merged, "the bytes the merged save landed");
    await pollUntil(phone.buffer, (text) => text.includes(" soon."), {
      deadlineMs: 15_000,
      describe: (text) => `the buffer never showed the merged line:\n${text}`,
    });

    ctx.log("a selection offers no Ask agent: the phone asks no agent");
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

    ctx.log("a wiki link tap asks the native stack to open its note");
    await browser(["find", "role", "button", "click", "--name", "Other", "--exact"]);
    await pollUntil(
      phone.sent,
      (frames) => frames.some((frame) => frame.type === "navigate" && frame.path === OTHER_PATH),
      {
        deadlineMs: 10_000,
        describe: (frames) =>
          `the tap never emitted navigate: ${JSON.stringify(frames.map((frame) => frame.type))}`,
      },
    );

    await driveItemMode(browser, page, ctx.log);

    ctx.log("loaded again in reader mode, the page reads a saved link as linkedom does");
    await reopenPage(browser, page);
    await browser(["eval", READER_PHONE_SCRIPT]);
    await browser(["eval", nativeFrameScript({ mode: "fill", nonce: READER_NONCE, type: "init" })]);
    await browser([
      "eval",
      nativeFrameScript({ id: 7, job: READER_JOB, nonce: READER_NONCE, type: "fillJob" }),
    ]);
    const answered = await pollUntil(
      async () =>
        parseEval(
          await browser(["eval", "JSON.stringify(window.__reader.sent)"]),
          z.array(pageFrameSchema),
        ),
      (frames) => frames.some((frame) => frame.type === "fillAnswer"),
      {
        deadlineMs: 15_000,
        describe: (frames) =>
          `the reader never answered: ${JSON.stringify(frames.map((frame) => frame.type))}`,
      },
    );
    const fillAnswer = answered.find((frame) => frame.type === "fillAnswer");
    expect(
      fillAnswer?.type === "fillAnswer" && fillAnswer.id === 7 && fillAnswer.nonce === READER_NONCE,
      `the reader's answer: ${JSON.stringify(fillAnswer)}`,
    );
    expectEq(
      fillAnswer.answer,
      readPage(READER_JOB, parsePage),
      "the page's reading against linkedom's",
    );
    expect(
      fillAnswer.answer.kind === "read" &&
        fillAnswer.answer.article.includes("they must be _files_ you can control") &&
        !fillAnswer.answer.article.includes("About"),
      `the reader kept the article and left the page's chrome: ${JSON.stringify(fillAnswer.answer)}`,
    );
    const drawn = await browser(["get", "text", "body"]);
    expect(!drawn.includes("File over app"), "the reader drew the page it read");
  },
};
