// The native end of the editor page's bridge, and the one policy for what the WebView may load.
// Pure: the screen attaches the WebView and hands it the ports over the account's library, so every
// frame it answers or drops runs under test. A frame counts only when it came from the page's own
// document (a child frame's message names its own address) and, after `init`, carries the nonce
// this load was given; a fresh load of the page gets a fresh nonce.

import { nativeFrameScript, parsePageFrame } from "@repo/editor-bridge/protocol";
import type {
  ItemInit,
  NativeFrame,
  PageFrame,
  RequestKind,
  RequestPayload,
  RequestResult,
  Unstamped,
} from "@repo/editor-bridge/protocol";
import { messageOf } from "../lib/error-message";
import { sameDocument } from "../lib/same-document";

// every question an item's page asks, answered from the account's library
export type EditorRequestPorts = {
  readonly [K in RequestKind]: (payload: RequestPayload<K>) => Promise<RequestResult<K>>;
};

// what the page says on its own
export type EditorPageEvent = Exclude<PageFrame, { type: "request" | "ready" }>;

// what the phone tells a loaded page on its own: an item moved
type EditorNativeEvent = Unstamped<Extract<NativeFrame, { type: "itemChanged" }>>;

// the part of the WebView the host drives
interface EditorView {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}

export interface EditorHostArgs {
  // the page's own address: a frame from any other document is dropped
  pageUrl: string;
  // what every load's `init` says
  init: Omit<ItemInit, "nonce" | "type">;
  mintNonce: () => string;
  ports: EditorRequestPorts;
  onEvent: (event: EditorPageEvent) => void;
}

export interface EditorHost {
  // the WebView the page lives in, as a callback ref hands it over; null once it is gone, and the
  // page with it
  attach: (view: EditorView | null) => void;
  // a message the WebView delivered, with the address of the document that sent it
  receive: (message: { data: string; url: string }) => void;
  send: (event: EditorNativeEvent) => void;
  // iOS killed the page's content process: the page loads again, and nothing is sent until it
  // says `ready`
  reload: () => void;
}

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

// a page request with its payload tied to its kind, so `ports[request.kind]` takes it with no
// switch (microsoft/TypeScript#47109)
interface RequestOf<K extends RequestKind> {
  id: number;
  nonce: string;
  kind: K;
  payload: RequestPayload<K>;
}

export const createEditorHost = (args: EditorHostArgs): EditorHost => {
  let view: EditorView | null = null;
  let nonce: string | null = null;

  const deliver = (frame: NativeFrame): void => {
    view?.injectJavaScript(nativeFrameScript(frame));
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

  const ask = async <K extends RequestKind>(request: RequestOf<K>): Promise<void> => {
    await respond(request, async () => await args.ports[request.kind](request.payload));
  };

  const connect = (): void => {
    nonce = args.mintNonce();
    deliver({ ...args.init, nonce, type: "init" });
  };

  return {
    attach: (next) => {
      if (next === null) {
        nonce = null;
      }
      view = next;
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
      args.onEvent(frame);
    },

    reload: () => {
      nonce = null;
      view?.reload();
    },

    send: (event) => {
      if (nonce !== null) {
        deliver({ ...event, nonce });
      }
    },
  };
};
