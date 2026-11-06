import { runInNewContext } from "node:vm";
import { nativeFrameSchema, PAGE_RECEIVER } from "@repo/editor-bridge/protocol";
import type {
  NativeFrame,
  PageFrame,
  RequestKind,
  RequestPayload,
  RequestResult,
} from "@repo/editor-bridge/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTask } from "../test-support/async";
import { createEditorHost, loadVerdict, openWindowVerdict } from "./editor-host";
import type { EditorPageEvent, EditorRequestPorts } from "./editor-host";

const PAGE_URL =
  "file:///private/var/containers/Bundle/Application/A/Inteligir.app/editor-page/index.html";

afterEach(() => {
  vi.useRealTimers();
});

// what the page's receiver is handed when the WebView runs an injected script
const framesOf = (script: string): NativeFrame[] => {
  const received: NativeFrame[] = [];
  runInNewContext(script, {
    window: {
      [PAGE_RECEIVER]: (text: string) => {
        received.push(nativeFrameSchema.parse(JSON.parse(text)));
      },
    },
  });
  return received;
};

const ITEM = "0190a000-0000-7000-8000-000000000001";
const OTHER = "0190a000-0000-7000-8000-000000000002";

// one answer per kind, each distinct, so a frame routed to the wrong port shows
const PORT_ANSWERS = {
  addHighlight: { queued: true },
  createNote: { id: ITEM },
  item: { item: null },
  noteHighlight: { queued: false },
  wikiTargets: { targets: [{ id: ITEM, path: "Plans.md", title: "Plans", type: "doc" }] },
  writeItem: { kind: "missing" },
} satisfies { [K in RequestKind]: RequestResult<K> };

const PAYLOADS = {
  addHighlight: { id: "c1", itemId: ITEM, quote: "a passage" },
  createNote: { besideId: ITEM, blocks: [], title: "Moved" },
  item: { itemId: ITEM },
  noteHighlight: { id: "c1", itemId: ITEM, text: "why?" },
  wikiTargets: {},
  writeItem: { files: [], itemId: ITEM, ops: [] },
} satisfies { [K in RequestKind]: RequestPayload<K> };

const KINDS: readonly RequestKind[] = [
  "item",
  "writeItem",
  "wikiTargets",
  "addHighlight",
  "noteHighlight",
  "createNote",
];

// one request of each kind, in KINDS' order, each carrying its id's position
const requestFrames = (nonce: string): PageFrame[] => [
  { id: 0, kind: "item", nonce, payload: PAYLOADS.item, type: "request" },
  { id: 1, kind: "writeItem", nonce, payload: PAYLOADS.writeItem, type: "request" },
  { id: 2, kind: "wikiTargets", nonce, payload: PAYLOADS.wikiTargets, type: "request" },
  { id: 3, kind: "addHighlight", nonce, payload: PAYLOADS.addHighlight, type: "request" },
  { id: 4, kind: "noteHighlight", nonce, payload: PAYLOADS.noteHighlight, type: "request" },
  { id: 5, kind: "createNote", nonce, payload: PAYLOADS.createNote, type: "request" },
];

interface PortCall {
  kind: RequestKind;
  payload: RequestPayload<RequestKind>;
}

const recordingPorts = () => {
  const calls: PortCall[] = [];
  const ports: EditorRequestPorts = {
    addHighlight: async (payload) => {
      calls.push({ kind: "addHighlight", payload });
      return PORT_ANSWERS.addHighlight;
    },
    createNote: async (payload) => {
      calls.push({ kind: "createNote", payload });
      return PORT_ANSWERS.createNote;
    },
    item: async (payload) => {
      calls.push({ kind: "item", payload });
      return PORT_ANSWERS.item;
    },
    noteHighlight: async (payload) => {
      calls.push({ kind: "noteHighlight", payload });
      return PORT_ANSWERS.noteHighlight;
    },
    wikiTargets: async (payload) => {
      calls.push({ kind: "wikiTargets", payload });
      return PORT_ANSWERS.wikiTargets;
    },
    writeItem: async (payload) => {
      calls.push({ kind: "writeItem", payload });
      return PORT_ANSWERS.writeItem;
    },
  };
  return { calls, ports };
};

const hostOver = (
  options: {
    focus?: "title" | "body" | null;
    flushTimeoutMs?: number;
    ports?: Partial<EditorRequestPorts>;
  } = {},
) => {
  const injected: NativeFrame[] = [];
  const events: EditorPageEvent[] = [];
  const recording = recordingPorts();
  const reloads: number[] = [];
  let minted = 0;
  const host = createEditorHost({
    flushTimeoutMs: options.flushTimeoutMs ?? 1000,
    init: { focus: options.focus ?? null, itemId: ITEM },
    mintNonce: () => {
      minted += 1;
      return `nonce-${String(minted).padStart(16, "0")}`;
    },
    onEvent: (event) => {
      events.push(event);
    },
    pageUrl: PAGE_URL,
    ports: { ...recording.ports, ...options.ports },
  });
  host.attach({
    injectJavaScript: (script) => {
      injected.push(...framesOf(script));
    },
    reload: () => {
      reloads.push(reloads.length);
    },
  });
  const fromPage = (frame: PageFrame, url = PAGE_URL): void => {
    host.receive({ data: JSON.stringify(frame), url });
  };
  // the page loads and says `ready`; the host answers with `init` and its nonce
  const load = (): string => {
    fromPage({ type: "ready" });
    const init = injected.findLast((frame) => frame.type === "init");
    if (init?.type !== "init") {
      throw new Error("the host answered ready with no init");
    }
    return init.nonce;
  };
  const responses = () => injected.filter((frame) => frame.type === "response");
  return { calls: recording.calls, events, fromPage, host, injected, load, reloads, responses };
};

describe("the native end of the editor page's bridge", () => {
  it("answers ready with init, a fresh nonce per load, and focus only on the first", () => {
    const { injected, load } = hostOver({ focus: "title" });
    const first = load();
    const second = load();
    expect(first).not.toBe(second);
    expect(injected).toMatchObject([
      { focus: "title", itemId: ITEM, mode: "item", nonce: first, type: "init" },
      { focus: null, itemId: ITEM, mode: "item", nonce: second, type: "init" },
    ]);
  });

  it("routes every request kind to its own port and answers under the nonce it came with", async () => {
    const { calls, fromPage, load, responses } = hostOver();
    const nonce = load();
    for (const frame of requestFrames(nonce)) {
      fromPage(frame);
    }
    await nextTask();
    expect(calls).toStrictEqual(KINDS.map((kind) => ({ kind, payload: PAYLOADS[kind] })));
    expect(responses()).toStrictEqual(
      KINDS.map((kind, id) => ({
        id,
        nonce,
        ok: true,
        result: PORT_ANSWERS[kind],
        type: "response",
      })),
    );
  });

  it("answers a port's refusal as the page's error, in its words", async () => {
    const { fromPage, load, responses } = hostOver({
      ports: {
        item: async () => {
          throw new Error("This is not an item on this phone.");
        },
      },
    });
    const nonce = load();
    fromPage({ id: 7, kind: "item", nonce, payload: { itemId: ITEM }, type: "request" });
    await nextTask();
    expect(responses()).toStrictEqual([
      { error: "This is not an item on this phone.", id: 7, nonce, ok: false, type: "response" },
    ]);
  });

  it("drops a frame under another load's nonce, or before any init", async () => {
    const { calls, events, fromPage, load, responses } = hostOver();
    fromPage({
      id: 0,
      kind: "wikiTargets",
      nonce: "nonce-0000000000000001",
      payload: {},
      type: "request",
    });
    const nonce = load();
    fromPage({ id: 1, kind: "wikiTargets", nonce: `${nonce}x`, payload: {}, type: "request" });
    fromPage({ itemId: OTHER, nonce: `${nonce}x`, type: "openItem" });
    await nextTask();
    expect(calls).toStrictEqual([]);
    expect(responses()).toStrictEqual([]);
    expect(events).toStrictEqual([]);
  });

  it("drops a frame from any document but the page's, a child frame's included", async () => {
    const { calls, events, fromPage, injected, load } = hostOver();
    fromPage({ type: "ready" }, "about:srcdoc");
    expect(injected).toStrictEqual([]);
    const nonce = load();
    for (const url of ["about:srcdoc", "https://example.com/", "file:///elsewhere/index.html"]) {
      fromPage({ id: 1, kind: "wikiTargets", nonce, payload: {}, type: "request" }, url);
      fromPage({ itemId: OTHER, nonce, type: "openItem" }, url);
    }
    await nextTask();
    expect(calls).toStrictEqual([]);
    expect(events).toStrictEqual([]);
    // the page's own address with a fragment is still the page
    fromPage({ itemId: OTHER, nonce, type: "openItem" }, `${PAGE_URL}#top`);
    expect(events).toStrictEqual([{ itemId: OTHER, nonce, type: "openItem" }]);
  });

  it("drops what the protocol refuses: broken json, an unknown kind, a malformed payload", async () => {
    const { calls, host, load, responses } = hostOver();
    const nonce = load();
    // what the page never sends, so no frame type spells it
    for (const data of [
      "{not json",
      JSON.stringify({ id: 1, kind: "format", nonce, payload: {}, type: "request" }),
      JSON.stringify({ id: 2, kind: "item", nonce, payload: { itemId: "" }, type: "request" }),
      JSON.stringify({
        id: 3,
        kind: "item",
        nonce,
        payload: { extra: 1, itemId: ITEM },
        type: "request",
      }),
    ]) {
      host.receive({ data, url: PAGE_URL });
    }
    await nextTask();
    expect(calls).toStrictEqual([]);
    expect(responses()).toStrictEqual([]);
  });

  it("hands every other page event on, and a flush waits for the page's own answer", async () => {
    const { events, fromPage, host, injected, load } = hostOver();
    const nonce = load();
    fromPage({ itemId: OTHER, nonce, type: "openItem" });
    fromPage({ dirty: true, nonce, saveError: "the library is full", type: "editorState" });
    fromPage({ ids: ["c1"], nonce, type: "showAnnotations" });
    expect(events).toStrictEqual([
      { itemId: OTHER, nonce, type: "openItem" },
      { dirty: true, nonce, saveError: "the library is full", type: "editorState" },
      { ids: ["c1"], nonce, type: "showAnnotations" },
    ]);

    let answered: boolean | null = null;
    const flushing = host.flush().then((ok) => {
      answered = ok;
    });
    const flush = injected.findLast((frame) => frame.type === "flush");
    if (flush?.type !== "flush") {
      throw new Error("the host sent no flush");
    }
    await nextTask();
    expect(answered).toBeNull();
    fromPage({ id: flush.id, nonce, ok: true, type: "flushed" });
    await flushing;
    expect(answered).toBe(true);
  });

  it("gives up on a flush the page never answers, or a page that went away", async () => {
    vi.useFakeTimers();
    const { host, load } = hostOver({ flushTimeoutMs: 50 });
    load();
    const unanswered = host.flush();
    await vi.advanceTimersByTimeAsync(50);
    await expect(unanswered).resolves.toBe(false);

    const gone = host.flush();
    host.attach(null);
    await expect(gone).resolves.toBe(false);
    // no page is loaded now, so nothing unsaved lives in one
    await expect(host.flush()).resolves.toBe(true);
  });

  it("loads the page again when its content process dies, and answers only the new load", async () => {
    const { calls, fromPage, host, load, reloads, responses } = hostOver();
    const before = load();
    const pending = host.flush();
    host.reload();
    expect(reloads).toHaveLength(1);
    await expect(pending).resolves.toBe(false);

    fromPage({ id: 1, kind: "wikiTargets", nonce: before, payload: {}, type: "request" });
    const after = load();
    fromPage({ id: 2, kind: "wikiTargets", nonce: after, payload: {}, type: "request" });
    await nextTask();
    expect(calls).toHaveLength(1);
    expect(responses()).toMatchObject([{ id: 2, nonce: after }]);
  });

  it("sends a change only to a loaded page, stamped with its nonce", () => {
    const { host, injected, load } = hostOver();
    host.send({ ids: [ITEM], overlapped: [], reset: false, type: "itemChanged" });
    expect(injected).toStrictEqual([]);
    const nonce = load();
    host.send({ ids: [ITEM], overlapped: [ITEM], reset: false, type: "itemChanged" });
    expect(injected.at(-1)).toStrictEqual({
      ids: [ITEM],
      nonce,
      overlapped: [ITEM],
      reset: false,
      type: "itemChanged",
    });
  });

  it("injects a frame the page reads back unchanged, whatever the item holds", async () => {
    const hostile = `</script><script>alert("x")</script> 'single' "double"  line para \\ \`tick\` \${x}`;
    const answer = { targets: [{ id: ITEM, path: "x.md", title: hostile, type: "doc" as const }] };
    const { fromPage, load, responses } = hostOver({
      ports: { wikiTargets: async () => await Promise.resolve(answer) },
    });
    const nonce = load();
    fromPage({ id: 1, kind: "wikiTargets", nonce, payload: {}, type: "request" });
    await nextTask();
    expect(responses()).toStrictEqual([
      { id: 1, nonce, ok: true, result: answer, type: "response" },
    ]);
  });
});

describe("what the WebView may load", () => {
  it("loads the page, and child frames only the page itself makes", () => {
    expect(loadVerdict({ isTopFrame: true, url: PAGE_URL }, PAGE_URL)).toStrictEqual({
      kind: "allow",
    });
    expect(loadVerdict({ isTopFrame: false, url: "about:srcdoc" }, PAGE_URL)).toStrictEqual({
      kind: "allow",
    });
    expect(loadVerdict({ isTopFrame: false, url: "https://example.com/" }, PAGE_URL)).toStrictEqual(
      { kind: "refuse" },
    );
    expect(loadVerdict({ isTopFrame: false, url: PAGE_URL }, PAGE_URL)).toStrictEqual({
      kind: "refuse",
    });
  });

  it("hands a followed web link to Safari and refuses every other page", () => {
    expect(loadVerdict({ isTopFrame: true, url: "https://example.com/a" }, PAGE_URL)).toStrictEqual(
      { kind: "open-outside", url: "https://example.com/a" },
    );
    for (const url of [
      "about:blank",
      "file:///etc/passwd",
      "inteligir://item/a",
      "tel:5551234",
      ["javascript", "alert(1)"].join(":"),
    ]) {
      expect(loadVerdict({ isTopFrame: true, url }, PAGE_URL)).toStrictEqual({ kind: "refuse" });
    }
    expect(openWindowVerdict("http://example.com/")).toStrictEqual({
      kind: "open-outside",
      url: "http://example.com/",
    });
    expect(openWindowVerdict("file:///etc/passwd")).toStrictEqual({ kind: "refuse" });
  });
});
