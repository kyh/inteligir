import { deferred } from "@repo/editor/deferred";
import type { Deferred } from "@repo/editor/deferred";
import { PAGE_RECEIVER, pageFrameSchema, parseNativeFrame, REQUESTS } from "./protocol";
import type {
  NativeFrame,
  PageFrame,
  PageInit,
  RequestKind,
  RequestPayload,
  RequestResult,
  Unstamped,
} from "./protocol";

declare global {
  interface Window {
    // injected by react-native-webview before any page script runs; absent in a plain browser
    ReactNativeWebView?: { postMessage: (message: string) => void };
    [PAGE_RECEIVER]?: (frame: string) => void;
  }
}

// what the page tells the native end on its own; the bridge stamps the nonce
type PageEvent = Unstamped<Exclude<PageFrame, { type: "request" | "ready" }>>;

// what the native end tells a connected page on its own
export type NativeEvent = Extract<
  NativeFrame,
  { type: "vaultChanged" | "flush" | "commentMeta" | "commentsRemoved" }
>;

// both ways, a frame is the JSON text of one, parsed by the end that receives it
export interface BridgeTransport {
  readonly send: (frame: string) => void;
  // installs the one door native frames come in by, for the page's life
  readonly listen: (receive: (frame: string) => void) => void;
}

export interface PageBridge {
  readonly request: <K extends RequestKind>(
    kind: K,
    payload: RequestPayload<K>,
  ) => Promise<RequestResult<K>>;
  readonly emit: (event: PageEvent) => void;
  readonly onNative: (listener: (event: NativeEvent) => void) => () => void;
}

export interface ConnectedPage {
  readonly bridge: PageBridge;
  readonly init: PageInit;
}

export const REQUEST_TIMEOUT_MS = 10_000;

// The native end answers every request, and a mutation timed out here still lands there, so these
// wait rather than report a failure that did not happen. A write keeps its deadline: it is guarded,
// so its retry finds what landed. The picker waits on the user, for as long as they browse.
const NO_DEADLINE: ReadonlySet<RequestKind> = new Set([
  "addComment",
  "pickImage",
  "remove",
  "rename",
  "writeAsset",
]);

interface Pending {
  readonly answer: Deferred<unknown>;
  readonly timer: ReturnType<typeof setTimeout> | null;
}

// Resolves on the first well-formed `init`; a second is another load's and is dropped. Before it,
// nothing but `ready` is sent, so no frame leaves the page without the nonce.
export const connectPageBridge = async (transport: BridgeTransport): Promise<ConnectedPage> => {
  const connected = deferred<ConnectedPage>();
  const pending = new Map<number, Pending>();
  const listeners = new Set<(event: NativeEvent) => void>();
  let nonce: string | null = null;
  let nextId = 0;

  const send = (frame: PageFrame): void => {
    transport.send(JSON.stringify(frame));
  };

  const connect = (stamp: string): PageBridge => ({
    emit: (event) => {
      send({ ...event, nonce: stamp });
    },
    onNative: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: async (kind, payload) => {
      const id = nextId;
      nextId += 1;
      // parsed on the way out too, so a malformed ask is refused here rather than by the phone
      const frame = pageFrameSchema.parse({ id, kind, nonce: stamp, payload, type: "request" });
      const answer = deferred<unknown>();
      const timer = NO_DEADLINE.has(kind)
        ? null
        : setTimeout(() => {
            pending.delete(id);
            answer.reject(
              new Error(`the phone did not answer ${kind} within ${String(REQUEST_TIMEOUT_MS)}ms`),
            );
          }, REQUEST_TIMEOUT_MS);
      pending.set(id, { answer, timer });
      send(frame);
      return REQUESTS[kind].result.parse(await answer.promise);
    },
  });

  const settle = (frame: Extract<NativeFrame, { type: "response" }>): void => {
    const entry = pending.get(frame.id);
    if (entry === undefined) {
      return;
    }
    pending.delete(frame.id);
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    if (frame.ok) {
      entry.answer.resolve(frame.result);
    } else {
      entry.answer.reject(new Error(frame.error));
    }
  };

  const receive = (text: string): void => {
    const frame = parseNativeFrame(text);
    if (frame === null) {
      return;
    }
    if (frame.type === "init") {
      if (nonce === null) {
        ({ nonce } = frame);
        connected.resolve({ bridge: connect(frame.nonce), init: frame });
      }
      return;
    }
    if (frame.nonce !== nonce) {
      return;
    }
    if (frame.type === "response") {
      settle(frame);
      return;
    }
    for (const listener of listeners) {
      listener(frame);
    }
  };

  transport.listen(receive);
  send({ type: "ready" });
  return await connected.promise;
};

// Non-writable and non-configurable, so no script in the page can swap the door and read what the
// native end sends through it.
export const windowTransport = (target: Window): BridgeTransport => ({
  listen: (receive) => {
    Object.defineProperty(target, PAGE_RECEIVER, {
      configurable: false,
      enumerable: false,
      value: receive,
      writable: false,
    });
  },
  send: (frame) => {
    target.ReactNativeWebView?.postMessage(frame);
  },
});
