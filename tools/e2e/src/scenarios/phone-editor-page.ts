import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

import {
  nativeFrameScript,
  PAGE_RECEIVER,
  pageFrameSchema,
} from "@repo/mobile-editor/bridge-protocol";
import type { NativeFrame, PageFrame } from "@repo/mobile-editor/bridge-protocol";

import { parseEval } from "../harness/agent-browser";
import type { ScenarioBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { buildProcessEnv, exec } from "../harness/exec";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

// a cold vite build of the page, mermaid and katex inlined; a cached one returns at once.
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

const ASK_AGENT = 'button[aria-label="Ask agent"]';

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

export const phoneEditorPage: Scenario = {
  description:
    "the phone's editor page loads from file:// and speaks its bridge: typed bytes land exactly, locked blocks take no typing, a change reloads, a merge shows, a forged frame is ignored, a link and Ask agent reach the native end",
  name: "phone-editor-page",
  // the build's own budget plus the drive
  timeoutMs: BUILD_TIMEOUT_MS + 120_000,
  async run(ctx) {
    // built through turbo, not looked for on disk: a present dist/ may be last week's page.
    await exec("pnpm", ["turbo", "run", "build", "--filter=@repo/mobile-editor"], {
      cwd: ctx.repoRoot,
      env: buildProcessEnv(),
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
      nonce: NONCE,
      path: NOTE_PATH,
      theme: "light",
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

    ctx.log("Ask agent sends the selection to the native end");
    expectEq(
      parseEval(await browser(["eval", caretScript("paragraph", true)]), z.string()),
      "placed",
      "the selection could not be made",
    );
    await pollUntil(
      async () => await browser(["is", "enabled", ASK_AGENT]),
      (enabled) => enabled.includes("true"),
      { deadlineMs: 10_000, describe: (enabled) => `Ask agent never enabled: ${enabled}` },
    );
    await browser(["click", ASK_AGENT]);
    await pollUntil(
      phone.sent,
      (frames) =>
        frames.some(
          (frame) =>
            frame.type === "askAgent" &&
            frame.path === NOTE_PATH &&
            frame.selection === "paragraph",
        ),
      { deadlineMs: 10_000, describe: () => "Ask agent never reached the native end" },
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
  },
};
