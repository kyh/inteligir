import { runInNewContext } from "node:vm";
import { nativeFrameSchema, PAGE_RECEIVER } from "@repo/editor-bridge/protocol";
import type {
  NativeFrame,
  PageFrame,
  RequestKind,
  RequestPayload,
  RequestResult,
} from "@repo/editor-bridge/protocol";
import { describe, expect, it } from "vitest";
import { nextTask } from "../test-support/async";
import { createEditorHost, loadVerdict, openWindowVerdict } from "./editor-host";
import type { EditorPageEvent, EditorRequestPorts } from "./editor-host";

const PAGE_URL =
  "file:///private/var/containers/Bundle/Application/A/Inteligir.app/editor-page/index.html";

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
const SHA = "a".repeat(64);

// one answer per kind, each distinct, so a frame routed to the wrong port shows
const PORT_ANSWERS = {
  item: { item: null },
  linkTargets: { targets: [{ id: ITEM, title: "Plans" }] },
  readFile: { file: { base64: "iVBORw==", mediaType: "image/png" } },
} satisfies { [K in RequestKind]: RequestResult<K> };

const PAYLOADS = {
  item: { itemId: ITEM },
  linkTargets: {},
  readFile: { sha: SHA },
} satisfies { [K in RequestKind]: RequestPayload<K> };

const KINDS: readonly RequestKind[] = ["item", "linkTargets", "readFile"];

// one request of each kind, in KINDS' order, each carrying its id's position
const requestFrames = (nonce: string): PageFrame[] => [
  { id: 0, kind: "item", nonce, payload: PAYLOADS.item, type: "request" },
  { id: 1, kind: "linkTargets", nonce, payload: PAYLOADS.linkTargets, type: "request" },
  { id: 2, kind: "readFile", nonce, payload: PAYLOADS.readFile, type: "request" },
];

interface PortCall {
  kind: RequestKind;
  payload: RequestPayload<RequestKind>;
}

const recordingPorts = () => {
  const calls: PortCall[] = [];
  const ports: EditorRequestPorts = {
    item: async (payload) => {
      calls.push({ kind: "item", payload });
      return PORT_ANSWERS.item;
    },
    linkTargets: async (payload) => {
      calls.push({ kind: "linkTargets", payload });
      return PORT_ANSWERS.linkTargets;
    },
    readFile: async (payload) => {
      calls.push({ kind: "readFile", payload });
      return PORT_ANSWERS.readFile;
    },
  };
  return { calls, ports };
};

const hostOver = (options: { ports?: Partial<EditorRequestPorts> } = {}) => {
  const injected: NativeFrame[] = [];
  const events: EditorPageEvent[] = [];
  const recording = recordingPorts();
  const reloads: number[] = [];
  let minted = 0;
  const host = createEditorHost({
    init: { itemId: ITEM },
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
  it("answers ready with init, a fresh nonce per load", () => {
    const { injected, load } = hostOver();
    const first = load();
    const second = load();
    expect(first).not.toBe(second);
    expect(injected).toStrictEqual([
      { itemId: ITEM, nonce: first, type: "init" },
      { itemId: ITEM, nonce: second, type: "init" },
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
      kind: "linkTargets",
      nonce: "nonce-0000000000000001",
      payload: {},
      type: "request",
    });
    const nonce = load();
    fromPage({ id: 1, kind: "linkTargets", nonce: `${nonce}x`, payload: {}, type: "request" });
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
      fromPage({ id: 1, kind: "linkTargets", nonce, payload: {}, type: "request" }, url);
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
      JSON.stringify({ id: 1, kind: "writeItem", nonce, payload: {}, type: "request" }),
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

  it("loads the page again when its content process dies, and answers only the new load", async () => {
    const { calls, fromPage, host, load, reloads, responses } = hostOver();
    const before = load();
    host.reload();
    expect(reloads).toHaveLength(1);

    fromPage({ id: 1, kind: "linkTargets", nonce: before, payload: {}, type: "request" });
    const after = load();
    fromPage({ id: 2, kind: "linkTargets", nonce: after, payload: {}, type: "request" });
    await nextTask();
    expect(calls).toHaveLength(1);
    expect(responses()).toMatchObject([{ id: 2, nonce: after }]);
  });

  it("sends a change only to a loaded page, stamped with its nonce", () => {
    const { host, injected, load } = hostOver();
    host.send({ ids: [ITEM], reset: false, type: "itemChanged" });
    expect(injected).toStrictEqual([]);
    const nonce = load();
    host.send({ ids: [ITEM], reset: false, type: "itemChanged" });
    expect(injected.at(-1)).toStrictEqual({
      ids: [ITEM],
      nonce,
      reset: false,
      type: "itemChanged",
    });
    host.attach(null);
    host.send({ ids: [], reset: true, type: "itemChanged" });
    expect(injected.filter((frame) => frame.type === "itemChanged")).toHaveLength(1);
  });

  it("injects a frame the page reads back unchanged, whatever the item holds", async () => {
    const hostile = `</script><script>alert("x")</script> 'single' "double"  line para \\ \`tick\` \${x}`;
    const answer = { targets: [{ id: ITEM, title: hostile }] };
    const { fromPage, load, responses } = hostOver({
      ports: { linkTargets: async () => await Promise.resolve(answer) },
    });
    const nonce = load();
    fromPage({ id: 1, kind: "linkTargets", nonce, payload: {}, type: "request" });
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
