// The native end of the bridge, as the page sees it: a transport that records every frame the page
// sends, answers its requests from an in-memory library of items and files a case can replace, and
// delivers native frames through the receiver the page installed.

import type { BridgeTransport } from "../bridge/page-bridge";
import type { HeldItem } from "../item/item-host";
import { pageFrameSchema } from "@repo/editor-bridge/protocol";
import type {
  NativeFrame,
  PageFrame,
  RequestKind,
  RequestResult,
} from "@repo/editor-bridge/protocol";

export const PHONE_NONCE = "test-nonce-0123456789";

type PageRequest = Extract<PageFrame, { type: "request" }>;

type PhoneAnswer =
  | { readonly ok: true; readonly result: RequestResult<RequestKind> }
  | { readonly ok: false; readonly error: string };

// null leaves the request unanswered
type Answerer = (request: PageRequest) => PhoneAnswer | null;

const ok = (result: RequestResult<RequestKind>): PhoneAnswer => ({ ok: true, result });

// a file the phone holds, as the bridge carries it
type HeldFile = Exclude<RequestResult<"readFile">["file"], null>;

// every item is a link target under its title
const answerFromLibrary =
  (items: Map<string, HeldItem>, files: Map<string, HeldFile>): Answerer =>
  (request) => {
    switch (request.kind) {
      case "item": {
        return ok({ item: items.get(request.payload.itemId) ?? null });
      }
      case "linkTargets": {
        return ok({ targets: [...items].map(([id, item]) => ({ id, title: item.fields.title })) });
      }
      case "readFile": {
        return ok({ file: files.get(request.payload.sha) ?? null });
      }
      default: {
        const exhaustive: never = request;
        return exhaustive;
      }
    }
  };

export interface FakePhone {
  readonly transport: BridgeTransport;
  readonly items: Map<string, HeldItem>;
  // the files the phone holds, by sha
  readonly files: Map<string, HeldFile>;
  readonly sent: PageFrame[];
  answer: Answerer;
  readonly deliver: (frame: NativeFrame) => void;
  // what a forged or broken sender could hand the receiver
  readonly deliverText: (text: string) => void;
  readonly init: (frame: { readonly itemId: string; readonly nonce?: string }) => void;
  readonly requests: <K extends PageRequest["kind"]>(
    kind: K,
  ) => Extract<PageRequest, { kind: K }>[];
  readonly events: <T extends Exclude<PageFrame["type"], "request">>(
    type: T,
  ) => Extract<PageFrame, { type: T }>[];
}

const isKind =
  <K extends PageRequest["kind"]>(kind: K) =>
  (frame: PageFrame): frame is Extract<PageRequest, { kind: K }> =>
    frame.type === "request" && frame.kind === kind;

const isType =
  <T extends PageFrame["type"]>(type: T) =>
  (frame: PageFrame): frame is Extract<PageFrame, { type: T }> =>
    frame.type === type;

export const createFakePhone = (library: Readonly<Record<string, HeldItem>> = {}): FakePhone => {
  const items = new Map(Object.entries(library));
  const files = new Map<string, HeldFile>();
  const sent: PageFrame[] = [];
  let receive: ((frame: string) => void) | null = null;

  const deliverText = (text: string): void => {
    if (receive === null) {
      throw new Error("the page has not installed its receiver");
    }
    receive(text);
  };

  const deliver = (frame: NativeFrame): void => {
    deliverText(JSON.stringify(frame));
  };

  const phone: FakePhone = {
    answer: answerFromLibrary(items, files),
    deliver,
    deliverText,
    events: (type) => sent.filter(isType(type)),
    files,
    init: ({ itemId, nonce = PHONE_NONCE }) => {
      deliver({ itemId, nonce, type: "init" });
    },
    items,
    requests: (kind) => sent.filter(isKind(kind)),
    sent,
    transport: {
      listen: (installed) => {
        receive = installed;
      },
      send: (text) => {
        const frame = pageFrameSchema.parse(JSON.parse(text));
        sent.push(frame);
        if (frame.type !== "request") {
          return;
        }
        // answered on a later turn, as a native round trip is
        queueMicrotask(() => {
          const answer = phone.answer(frame);
          if (answer !== null) {
            deliver({ ...answer, id: frame.id, nonce: PHONE_NONCE, type: "response" });
          }
        });
      },
    },
  };
  return phone;
};
