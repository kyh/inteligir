// The native end of the bridge, as the page sees it: a transport that records every frame the page
// sends, answers its requests from an in-memory vault a case can replace, and delivers native
// frames through the receiver the page installed.

import { docStem } from "@repo/notes/knowledge/doc-file";

import type { BridgeTransport } from "../bridge/page-bridge";
import { pageFrameSchema } from "../bridge/protocol";
import type {
  NativeFrame,
  PageFrame,
  PageInit,
  RequestKind,
  RequestResult,
} from "../bridge/protocol";

export const PHONE_NONCE = "test-nonce-0123456789";

type PageRequest = Extract<PageFrame, { type: "request" }>;

type PhoneAnswer =
  | { readonly ok: true; readonly result: RequestResult<RequestKind> }
  | { readonly ok: false; readonly error: string };

// null leaves the request unanswered
type Answerer = (request: PageRequest) => PhoneAnswer | null;

const ok = (result: RequestResult<RequestKind>): PhoneAnswer => ({ ok: true, result });

const refuse = (error: string): PhoneAnswer => ({ error, ok: false });

// the base is compared with the text held, the page's CAS as the phone runs it
const writeAnswer = (
  files: Map<string, string>,
  { content, guard, path }: Extract<PageRequest, { kind: "write" }>["payload"],
): PhoneAnswer => {
  const current = files.get(path);
  if (guard.kind === "absent") {
    if (current !== undefined) {
      return ok({ kind: "exists" });
    }
  } else if (current === undefined) {
    return ok({ kind: "missing" });
  } else if (current !== guard.base) {
    return ok({ current, kind: "changed" });
  }
  files.set(path, content);
  return ok({ kind: "written" });
};

const answerFromVault =
  (files: Map<string, string>): Answerer =>
  (request) => {
    switch (request.kind) {
      case "list": {
        return ok({ paths: [...files.keys()] });
      }
      case "read": {
        const content = files.get(request.payload.path);
        return content === undefined ? refuse(`no ${request.payload.path}`) : ok({ content });
      }
      case "write": {
        return writeAnswer(files, request.payload);
      }
      // the note lands as a write does; the comment's entry is the phone's store's, which a case
      // reads off the request
      case "addComment": {
        const { base, content, path } = request.payload;
        return writeAnswer(files, { content, guard: { base, kind: "expected" }, path });
      }
      case "remove": {
        files.delete(request.payload.path);
        return ok({});
      }
      case "rename": {
        const { from, to } = request.payload;
        const content = files.get(from);
        if (content === undefined) {
          return ok({ error: `no ${from}`, ok: false });
        }
        files.delete(from);
        files.set(to, content);
        return ok({ ok: true });
      }
      case "wikiTargets": {
        return ok({
          targets: [...files.keys()].map((path) => ({ path, title: docStem(path), type: "doc" })),
        });
      }
      case "readAsset": {
        return refuse(`no attachment at ${request.payload.path}`);
      }
      case "writeAsset": {
        return refuse("this phone takes no attachments");
      }
      case "pickImage": {
        return ok({ kind: "cancelled" });
      }
      default: {
        const exhaustive: never = request;
        return exhaustive;
      }
    }
  };

export interface FakePhone {
  readonly transport: BridgeTransport;
  readonly files: Map<string, string>;
  readonly sent: PageFrame[];
  answer: Answerer;
  readonly deliver: (frame: NativeFrame) => void;
  // what a forged or broken sender could hand the receiver
  readonly deliverText: (text: string) => void;
  readonly init: (overrides?: Partial<PageInit>) => void;
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

export const createFakePhone = (initial: Readonly<Record<string, string>> = {}): FakePhone => {
  const files = new Map(Object.entries(initial));
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
    answer: answerFromVault(files),
    deliver,
    deliverText,
    events: (type) => sent.filter(isType(type)),
    files,
    init: (overrides = {}) => {
      deliver({
        focus: null,
        nonce: PHONE_NONCE,
        path: "Note.md",
        theme: "light",
        type: "init",
        ...overrides,
      });
    },
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
