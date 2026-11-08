// The native end of the bridge, as the page sees it: a transport that records every frame the page
// sends, answers its requests from an in-memory library of items (which lands an item page's ops
// only on the bases they name, as the phone's replica does) a case can replace, and delivers
// native frames through the receiver the page installed.

import { applyOps, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { noteFields } from "@repo/notes/test-support/library-items";

import type { BridgeTransport } from "../bridge/page-bridge";
import { pageFrameSchema } from "@repo/editor-bridge/protocol";
import type {
  ItemInit,
  NativeFrame,
  PageFrame,
  RequestKind,
  RequestResult,
} from "@repo/editor-bridge/protocol";

export const PHONE_NONCE = "test-nonce-0123456789";

// the library's cap on one file, as the phone names it in `init`
const FILE_MAX_BYTES = 100 * 1024 * 1024;

type PageRequest = Extract<PageFrame, { type: "request" }>;

type PhoneAnswer =
  | { readonly ok: true; readonly result: RequestResult<RequestKind> }
  | { readonly ok: false; readonly error: string };

// null leaves the request unanswered
type Answerer = (request: PageRequest) => PhoneAnswer | null;

const ok = (result: RequestResult<RequestKind>): PhoneAnswer => ({ ok: true, result });

type HeldItem = Exclude<RequestResult<"item">["item"], null>;

const heldOf = (state: ItemState): HeldItem => ({
  blocks: orderedBlocks(state.blocks),
  bodyHeld: true,
  fields: state.fields,
});

// an item page's ops, landed whole over the item as the phone holds it, or answered with the item
// as it is when a base moved under them
const writeItemAnswer = (
  items: Map<string, ItemState>,
  { itemId, ops }: Extract<PageRequest, { kind: "writeItem" }>["payload"],
): PhoneAnswer => {
  const held = items.get(itemId);
  if (held === undefined) {
    return ok({ kind: "missing" });
  }
  const outcome = applyOps(held, ops);
  if (outcome.kind === "conflict") {
    return ok({ item: heldOf(held), kind: "changed" });
  }
  if (outcome.kind === "invalid") {
    return ok({ fields: [...outcome.fields], kind: "invalid" });
  }
  items.set(itemId, outcome.state);
  return ok({ kind: "queued" });
};

// a note the page makes joins the library under the next free id, its blocks the note's
const createNoteAnswer = (
  items: Map<string, ItemState>,
  { blocks, title }: Extract<PageRequest, { kind: "createNote" }>["payload"],
): PhoneAnswer => {
  const id = `0190a000-0000-7000-8000-${String(items.size + 1).padStart(12, "0")}`;
  items.set(id, {
    blocks: new Map(
      blocks.map(({ block, ord }) => [
        block.id,
        { block, hash: blockHash(block), ord, section: "note" as const },
      ]),
    ),
    fields: noteFields({ title }),
  });
  return ok({ id });
};

// a file the phone holds, as the bridge carries it
type HeldFile = Extract<PageRequest, { kind: "keepFile" }>["payload"];

// every item is a link target under its title, and a kept file is held under the next free pretend
// sha
const answerFromLibrary =
  (items: Map<string, ItemState>, files: Map<string, HeldFile>): Answerer =>
  (request) => {
    switch (request.kind) {
      case "item": {
        const held = items.get(request.payload.itemId);
        return ok({ item: held === undefined ? null : heldOf(held) });
      }
      case "writeItem": {
        return writeItemAnswer(items, request.payload);
      }
      case "createNote": {
        return createNoteAnswer(items, request.payload);
      }
      case "linkTargets": {
        return ok({
          targets: [...items].map(([id, state]) => ({ id, title: state.fields.title })),
        });
      }
      case "keepFile": {
        const sha = String(files.size + 1).padStart(64, "0");
        files.set(sha, request.payload);
        return ok({ sha });
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
  readonly items: Map<string, ItemState>;
  // the files the phone holds, by sha
  readonly files: Map<string, HeldFile>;
  readonly sent: PageFrame[];
  answer: Answerer;
  readonly deliver: (frame: NativeFrame) => void;
  // what a forged or broken sender could hand the receiver
  readonly deliverText: (text: string) => void;
  readonly init: (overrides: Partial<ItemInit> & Pick<ItemInit, "itemId">) => void;
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

export const createFakePhone = (library: Readonly<Record<string, ItemState>> = {}): FakePhone => {
  const items = new Map(Object.entries(library));
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

  const files = new Map<string, HeldFile>();
  const phone: FakePhone = {
    answer: answerFromLibrary(items, files),
    deliver,
    deliverText,
    events: (type) => sent.filter(isType(type)),
    init: (overrides) => {
      deliver({
        fileMaxBytes: FILE_MAX_BYTES,
        focus: null,
        mode: "item",
        nonce: PHONE_NONCE,
        type: "init",
        ...overrides,
      });
    },
    files,
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
