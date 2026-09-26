// The native end of the editor page's bridge, and the one policy for what the WebView may load.
// Pure: the screen attaches the WebView and hands it the ports over the phone's store, so every
// frame it answers or drops runs under test. A frame counts only when it came from the page's own
// document (a child frame's message names its own address) and, after `init`, carries the nonce
// this load was given; a fresh load of the page gets a fresh nonce.

import { nativeFrameScript, pageFrameSchema } from "@repo/mobile-editor/bridge-protocol";
import type {
  NativeFrame,
  PageFrame,
  PageInit,
  RequestKind,
  RequestPayload,
  RequestResult,
} from "@repo/mobile-editor/bridge-protocol";

// every question the page asks, answered by the phone
export type EditorRequestPorts = {
  readonly [K in RequestKind]: (payload: RequestPayload<K>) => Promise<RequestResult<K>>;
};

// what the page says on its own; a `flushed` is the host's to settle
export type EditorPageEvent = Exclude<PageFrame, { type: "request" | "ready" | "flushed" }>;

type Unstamped<F> = F extends { readonly nonce: string } ? Omit<F, "nonce"> : never;

// what the phone tells a loaded page on its own
type EditorNativeEvent = Unstamped<Extract<NativeFrame, { type: "vaultChanged" | "theme" }>>;

// the part of the WebView the host drives
interface EditorView {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}

export interface EditorHostArgs {
  // the page's own address: a frame from any other document is dropped
  pageUrl: string;
  // what the first load's `init` says; a later load opens the note the page last said it shows,
  // which a rename moves, with no focus, since the keyboard it would raise is one the user never
  // asked for again
  init: Omit<PageInit, "nonce" | "type">;
  mintNonce: () => string;
  ports: EditorRequestPorts;
  onEvent: (event: EditorPageEvent) => void;
  flushTimeoutMs?: number;
}

export interface EditorHost {
  // the WebView the page lives in, as a callback ref hands it over; null once it is gone, and the
  // page with it
  attach: (view: EditorView | null) => void;
  // a message the WebView delivered, with the address of the document that sent it
  receive: (message: { data: string; url: string }) => void;
  send: (event: EditorNativeEvent) => void;
  // true once the page says the open note's edits are written; false when it failed, did not
  // answer in time or went away first. no page loaded holds no edits, so that is true at once.
  flush: () => Promise<boolean>;
  // iOS killed the page's content process: the page loads again, and nothing is sent until it
  // says `ready`
  reload: () => void;
}

// long enough for a serialize and a write through the bridge, short enough that leaving a note
// never waits on a page that stopped answering
const FLUSH_TIMEOUT_MS = 3000;

// a fragment never names another document, and WebKit may hand back escapes the uri was given raw
const documentOf = (url: string): string => {
  const hash = url.indexOf("#");
  const bare = hash === -1 ? url : url.slice(0, hash);
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
};

const sameDocument = (url: string, pageUrl: string): boolean =>
  documentOf(url) === documentOf(pageUrl);

const isHttpUrl = (url: string): boolean => /^https?:\/\//iu.test(url);

// a child frame the page itself makes: the html block's sandboxed preview, an inert blank
const PAGE_CHILD_FRAMES: ReadonlySet<string> = new Set(["about:blank", "about:srcdoc"]);

export type LoadVerdict =
  | { kind: "allow" }
  | { kind: "refuse" }
  // a web link the user followed: Safari opens it, and the WebView never leaves the page
  | { kind: "open-outside"; url: string };

export const loadVerdict = (
  request: { url: string; isTopFrame: boolean },
  pageUrl: string,
): LoadVerdict => {
  if (request.isTopFrame) {
    if (sameDocument(request.url, pageUrl)) {
      return { kind: "allow" };
    }
    return isHttpUrl(request.url) ? { kind: "open-outside", url: request.url } : { kind: "refuse" };
  }
  return PAGE_CHILD_FRAMES.has(request.url) ? { kind: "allow" } : { kind: "refuse" };
};

// window.open and a target=_blank link: never a second WebView, only Safari, only for the web
export const openWindowVerdict = (url: string): LoadVerdict =>
  isHttpUrl(url) ? { kind: "open-outside", url } : { kind: "refuse" };

// null for anything that is not a well-formed frame
const parsePageFrame = (text: string): PageFrame | null => {
  try {
    const parsed = pageFrameSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

type PageRequest = Extract<PageFrame, { type: "request" }>;

export const createEditorHost = (args: EditorHostArgs): EditorHost => {
  const flushTimeoutMs = args.flushTimeoutMs ?? FLUSH_TIMEOUT_MS;
  const flushes = new Map<number, (ok: boolean) => void>();
  let view: EditorView | null = null;
  let nonce: string | null = null;
  let { path } = args.init;
  let loads = 0;
  let nextFlushId = 0;

  const deliver = (frame: NativeFrame): void => {
    view?.injectJavaScript(nativeFrameScript(frame));
  };

  const settleFlushes = (ok: boolean): void => {
    const waiting = [...flushes.values()];
    flushes.clear();
    for (const settle of waiting) {
      settle(ok);
    }
  };

  // an answer for a load that has since been replaced reaches nobody who asked
  const respond = async <K extends RequestKind>(
    request: { id: number; nonce: string },
    answer: () => Promise<RequestResult<K>>,
  ): Promise<void> => {
    let frame: NativeFrame;
    try {
      frame = {
        id: request.id,
        nonce: request.nonce,
        ok: true,
        result: await answer(),
        type: "response",
      };
    } catch (error) {
      frame = {
        error: messageOf(error),
        id: request.id,
        nonce: request.nonce,
        ok: false,
        type: "response",
      };
    }
    if (request.nonce === nonce) {
      deliver(frame);
    }
  };

  const ask = async (request: PageRequest): Promise<void> => {
    const { ports } = args;
    switch (request.kind) {
      case "list": {
        await respond(request, async () => await ports.list(request.payload));
        return;
      }
      case "pickImage": {
        await respond(request, async () => await ports.pickImage(request.payload));
        return;
      }
      case "read": {
        await respond(request, async () => await ports.read(request.payload));
        return;
      }
      case "readAsset": {
        await respond(request, async () => await ports.readAsset(request.payload));
        return;
      }
      case "remove": {
        await respond(request, async () => await ports.remove(request.payload));
        return;
      }
      case "rename": {
        await respond(request, async () => await ports.rename(request.payload));
        return;
      }
      case "wikiTargets": {
        await respond(request, async () => await ports.wikiTargets(request.payload));
        return;
      }
      case "write": {
        await respond(request, async () => await ports.write(request.payload));
        return;
      }
      case "writeAsset": {
        await respond(request, async () => await ports.writeAsset(request.payload));
      }
      // no default
    }
  };

  // the page that was loaded holds nothing now
  const forget = (): void => {
    nonce = null;
    settleFlushes(false);
  };

  const connect = (): void => {
    settleFlushes(false);
    nonce = args.mintNonce();
    const first = loads === 0;
    loads += 1;
    deliver({
      ...args.init,
      focus: first ? args.init.focus : null,
      nonce,
      path,
      type: "init",
    });
  };

  return {
    attach: (next) => {
      if (next === null) {
        forget();
      }
      view = next;
    },

    flush: async () => {
      const stamp = nonce;
      if (stamp === null) {
        return true;
      }
      const id = nextFlushId;
      nextFlushId += 1;
      // oxlint-disable-next-line promise/avoid-new -- the page answers as a frame, which only a promise can hand to an await
      return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          flushes.delete(id);
          resolve(false);
        }, flushTimeoutMs);
        flushes.set(id, (ok) => {
          clearTimeout(timer);
          resolve(ok);
        });
        deliver({ id, nonce: stamp, type: "flush" });
      });
    },

    receive: ({ data, url }) => {
      if (!sameDocument(url, args.pageUrl)) {
        return;
      }
      const frame = parsePageFrame(data);
      if (frame === null) {
        return;
      }
      if (frame.type === "ready") {
        connect();
        return;
      }
      if (nonce === null || frame.nonce !== nonce) {
        return;
      }
      if (frame.type === "request") {
        void ask(frame);
        return;
      }
      if (frame.type === "flushed") {
        const settle = flushes.get(frame.id);
        flushes.delete(frame.id);
        settle?.(frame.ok);
        return;
      }
      if (frame.type === "opened" && frame.path !== null) {
        ({ path } = frame);
      }
      args.onEvent(frame);
    },

    reload: () => {
      forget();
      view?.reload();
    },

    send: (event) => {
      if (nonce !== null) {
        deliver({ ...event, nonce });
      }
    },
  };
};
