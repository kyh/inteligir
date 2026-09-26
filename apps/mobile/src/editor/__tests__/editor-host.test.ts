import { runInNewContext } from "node:vm";
import { nativeFrameSchema, PAGE_RECEIVER } from "@repo/mobile-editor/bridge-protocol";
import type {
  NativeFrame,
  PageFrame,
  RequestKind,
  RequestPayload,
  RequestResult,
} from "@repo/mobile-editor/bridge-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorHost, loadVerdict, openWindowVerdict } from "../editor-host";
import type { EditorPageEvent, EditorRequestPorts } from "../editor-host";

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

// a macrotask: every port the frames reached has answered by then
const settled = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- a timer only a promise can hand to an await
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

// one answer per kind, each distinct, so a frame routed to the wrong port shows
const PORT_ANSWERS = {
  addComment: { current: "# a\n", kind: "changed" },
  list: { paths: ["a.md"] },
  pickImage: { kind: "cancelled" },
  read: { content: "# a\n" },
  readAsset: { base64: "AA==", mediaType: "image/png" },
  remove: {},
  rename: { ok: true },
  wikiTargets: { targets: [{ path: "a.md", title: "a", type: "doc" }] },
  write: { kind: "written" },
  writeAsset: { path: "assets/p.jpg" },
} satisfies { [K in RequestKind]: RequestResult<K> };

const PAYLOADS = {
  addComment: {
    base: "# a\n",
    content: "%%i:c1:start%%# a%%i:c1:end%%\n",
    id: "c1",
    path: "a.md",
    text: "why?",
  },
  list: {},
  pickImage: {},
  read: { path: "a.md" },
  readAsset: { path: "assets/p.jpg" },
  remove: { path: "a.md" },
  rename: { from: "a.md", to: "b.md" },
  wikiTargets: {},
  write: { content: "# a\nmore\n", guard: { base: "# a\n", kind: "expected" }, path: "a.md" },
  writeAsset: { base64: "AA==", baseName: "p.jpg", mediaType: "image/jpeg" },
} satisfies { [K in RequestKind]: RequestPayload<K> };

const KINDS: readonly RequestKind[] = [
  "list",
  "pickImage",
  "read",
  "readAsset",
  "remove",
  "rename",
  "wikiTargets",
  "write",
  "writeAsset",
  "addComment",
];

// one request of each kind, in KINDS' order, each carrying its id's position
const requestFrames = (nonce: string): PageFrame[] => [
  { id: 0, kind: "list", nonce, payload: PAYLOADS.list, type: "request" },
  { id: 1, kind: "pickImage", nonce, payload: PAYLOADS.pickImage, type: "request" },
  { id: 2, kind: "read", nonce, payload: PAYLOADS.read, type: "request" },
  { id: 3, kind: "readAsset", nonce, payload: PAYLOADS.readAsset, type: "request" },
  { id: 4, kind: "remove", nonce, payload: PAYLOADS.remove, type: "request" },
  { id: 5, kind: "rename", nonce, payload: PAYLOADS.rename, type: "request" },
  { id: 6, kind: "wikiTargets", nonce, payload: PAYLOADS.wikiTargets, type: "request" },
  { id: 7, kind: "write", nonce, payload: PAYLOADS.write, type: "request" },
  { id: 8, kind: "writeAsset", nonce, payload: PAYLOADS.writeAsset, type: "request" },
  { id: 9, kind: "addComment", nonce, payload: PAYLOADS.addComment, type: "request" },
];

interface PortCall {
  kind: RequestKind;
  payload: RequestPayload<RequestKind>;
}

const recordingPorts = () => {
  const calls: PortCall[] = [];
  const ports: EditorRequestPorts = {
    addComment: async (payload) => {
      calls.push({ kind: "addComment", payload });
      return PORT_ANSWERS.addComment;
    },
    list: async (payload) => {
      calls.push({ kind: "list", payload });
      return PORT_ANSWERS.list;
    },
    pickImage: async (payload) => {
      calls.push({ kind: "pickImage", payload });
      return PORT_ANSWERS.pickImage;
    },
    read: async (payload) => {
      calls.push({ kind: "read", payload });
      return PORT_ANSWERS.read;
    },
    readAsset: async (payload) => {
      calls.push({ kind: "readAsset", payload });
      return PORT_ANSWERS.readAsset;
    },
    remove: async (payload) => {
      calls.push({ kind: "remove", payload });
      return PORT_ANSWERS.remove;
    },
    rename: async (payload) => {
      calls.push({ kind: "rename", payload });
      return PORT_ANSWERS.rename;
    },
    wikiTargets: async (payload) => {
      calls.push({ kind: "wikiTargets", payload });
      return PORT_ANSWERS.wikiTargets;
    },
    write: async (payload) => {
      calls.push({ kind: "write", payload });
      return PORT_ANSWERS.write;
    },
    writeAsset: async (payload) => {
      calls.push({ kind: "writeAsset", payload });
      return PORT_ANSWERS.writeAsset;
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
    init: { focus: options.focus ?? null, path: "a.md", theme: "system" },
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
      { focus: "title", nonce: first, path: "a.md", theme: "system", type: "init" },
      { focus: null, nonce: second, path: "a.md", type: "init" },
    ]);
  });

  it("routes every request kind to its own port and answers under the nonce it came with", async () => {
    const { calls, fromPage, load, responses } = hostOver();
    const nonce = load();
    for (const frame of requestFrames(nonce)) {
      fromPage(frame);
    }
    await settled();
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
        read: async () => {
          throw new Error("This is not a note on this phone.");
        },
      },
    });
    const nonce = load();
    fromPage({ id: 7, kind: "read", nonce, payload: { path: "a.md" }, type: "request" });
    await settled();
    expect(responses()).toStrictEqual([
      { error: "This is not a note on this phone.", id: 7, nonce, ok: false, type: "response" },
    ]);
  });

  it("drops a frame under another load's nonce, or before any init", async () => {
    const { calls, events, fromPage, load, responses } = hostOver();
    fromPage({
      id: 0,
      kind: "list",
      nonce: "nonce-0000000000000001",
      payload: {},
      type: "request",
    });
    const nonce = load();
    fromPage({ id: 1, kind: "list", nonce: `${nonce}x`, payload: {}, type: "request" });
    fromPage({ nonce: `${nonce}x`, path: "b.md", type: "navigate" });
    await settled();
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
      fromPage({ id: 1, kind: "list", nonce, payload: {}, type: "request" }, url);
      fromPage({ nonce, path: "b.md", type: "navigate" }, url);
    }
    await settled();
    expect(calls).toStrictEqual([]);
    expect(events).toStrictEqual([]);
    // the page's own address with a fragment is still the page
    fromPage({ nonce, path: "b.md", type: "navigate" }, `${PAGE_URL}#top`);
    expect(events).toStrictEqual([{ nonce, path: "b.md", type: "navigate" }]);
  });

  it("drops what the protocol refuses: broken json, an unknown kind, a path the vault would move", async () => {
    const { calls, host, load, responses } = hostOver();
    const nonce = load();
    // what the page never sends, so no frame type spells it
    for (const data of [
      "{not json",
      JSON.stringify({ id: 1, kind: "format", nonce, payload: {}, type: "request" }),
      JSON.stringify({
        id: 2,
        kind: "read",
        nonce,
        payload: { path: "../out.md" },
        type: "request",
      }),
      JSON.stringify({
        id: 3,
        kind: "read",
        nonce,
        payload: { extra: 1, path: "a.md" },
        type: "request",
      }),
    ]) {
      host.receive({ data, url: PAGE_URL });
    }
    await settled();
    expect(calls).toStrictEqual([]);
    expect(responses()).toStrictEqual([]);
  });

  it("hands every other page event on, and a flush waits for the page's own answer", async () => {
    const { events, fromPage, host, injected, load } = hostOver();
    const nonce = load();
    fromPage({ nonce, path: "b.md", selection: "why", type: "askAgent" });
    expect(events).toStrictEqual([{ nonce, path: "b.md", selection: "why", type: "askAgent" }]);

    let answered: boolean | null = null;
    const flushing = host.flush().then((ok) => {
      answered = ok;
    });
    const flush = injected.findLast((frame) => frame.type === "flush");
    if (flush?.type !== "flush") {
      throw new Error("the host sent no flush");
    }
    await settled();
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
    expect(await unanswered).toBe(false);

    const gone = host.flush();
    host.attach(null);
    expect(await gone).toBe(false);
    // no page is loaded now, so nothing unsaved lives in one
    expect(await host.flush()).toBe(true);
  });

  it("opens a later load on the note the page last said it shows, a rename's new name", () => {
    const { fromPage, injected, load } = hostOver({ focus: "title" });
    const nonce = load();
    fromPage({ nonce, path: "renamed.md", type: "opened" });
    fromPage({ nonce, path: null, type: "opened" });
    load();
    expect(injected.at(-1)).toMatchObject({ focus: null, path: "renamed.md", type: "init" });
  });

  it("loads the page again when its content process dies, and answers only the new load", async () => {
    const { calls, fromPage, host, load, reloads, responses } = hostOver();
    const before = load();
    const pending = host.flush();
    host.reload();
    expect(reloads).toHaveLength(1);
    expect(await pending).toBe(false);

    fromPage({ id: 1, kind: "list", nonce: before, payload: {}, type: "request" });
    const after = load();
    fromPage({ id: 2, kind: "list", nonce: after, payload: {}, type: "request" });
    await settled();
    expect(calls).toHaveLength(1);
    expect(responses()).toMatchObject([{ id: 2, nonce: after }]);
  });

  it("sends a change only to a loaded page, stamped with its nonce", () => {
    const { host, injected, load } = hostOver();
    host.send({ event: { kind: "content", path: "a.md" }, type: "vaultChanged" });
    expect(injected).toStrictEqual([]);
    const nonce = load();
    host.send({ event: { kind: "files", paths: null }, type: "vaultChanged" });
    expect(injected.at(-1)).toStrictEqual({
      event: { kind: "files", paths: null },
      nonce,
      type: "vaultChanged",
    });
  });

  it("injects a frame the page reads back unchanged, whatever the note holds", async () => {
    const hostile = `</script><script>alert("x")</script> 'single' "double"  line para \\ \`tick\` \${x}`;
    const { fromPage, load, responses } = hostOver({
      ports: { read: async () => ({ content: hostile }) },
    });
    const nonce = load();
    fromPage({ id: 1, kind: "read", nonce, payload: { path: "a.md" }, type: "request" });
    await settled();
    expect(responses()).toStrictEqual([
      { id: 1, nonce, ok: true, result: { content: hostile }, type: "response" },
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
      "inteligir://notes/a.md",
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
