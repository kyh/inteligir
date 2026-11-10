// The fake's thinking signatures, bound as Claude Sonnet 5.5 binds a replayed thinking block: to the
// request's system, its tools and every message before the block from the conversation's last
// compaction block on, compared as the API compares them (`./fake-request.ts` `prefixOf`), and
// chained to the thinking block before it since that compaction. So a request that leaves out a
// leading run of thinking blocks, the first after the last compaction block first, still
// verifies, and any other edit, a block removed from the middle included, fails from the edit on;
// what comes before the last compaction block is ignored, as the API ignores it
// (platform.claude.com/docs/en/build-with-claude/preserved-thinking). A signature is the previous
// block's mac and the block's own: an HMAC over its prefix, its text and that previous mac.

import { anchorOf, asParsed, beforeAnchor, prefixOf } from "./fake-request.ts";
import type { FakeBlock, FakeRequest } from "./fake-request.ts";

// fixed, so a body sent again after a cut carries the signatures it first got
const KEY_TEXT = "messages-fake thinking signatures";

const NO_PREVIOUS = "-";

const encoder = new TextEncoder();

const keyPromise = crypto.subtle.importKey(
  "raw",
  encoder.encode(KEY_TEXT),
  { hash: "SHA-256", name: "HMAC" },
  false,
  ["sign"],
);

export const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const macOf = async (prefix: string, thinking: string, previous: string): Promise<string> =>
  hex(
    await crypto.subtle.sign(
      "HMAC",
      await keyPromise,
      encoder.encode(JSON.stringify([prefix, thinking, previous])),
    ),
  );

const macPart = (signature: string): string => signature.split(".")[1] ?? "";

// the signature of a thinking block of the fake's reply to `request`, after the reply's blocks
// `before` as the next request will carry them back, the thinking block before it in the
// conversation since its last compaction signed `previous`: bound as the next request will carry
// it, the reply an assistant message after every message sent
export const signThinking = async (
  request: FakeRequest,
  reply: { readonly before: readonly FakeBlock[]; readonly thinking: string },
  previous: string | null,
): Promise<string> => {
  const chained = previous === null ? NO_PREVIOUS : macPart(previous);
  const answered = {
    ...request,
    messages: [
      ...request.messages,
      { content: asParsed(reply.before), role: "assistant" as const },
    ],
  };
  const prefix = prefixOf(answered, { at: reply.before.length, index: request.messages.length });
  return `${chained}.${await macOf(prefix, reply.thinking, chained)}`;
};

export interface ThinkingCheck {
  // the paths, as the API names them, of the blocks that do not verify, in order
  readonly failed: readonly string[];
  // the signature of the last block that verified, which the reply's own chains to
  readonly last: string | null;
}

// every replayed thinking block since the last compaction checked in order, the chain starting
// afresh there; one that fails is left out, so the blocks after an edit fail with it
export const checkThinking = async (request: FakeRequest): Promise<ThinkingCheck> => {
  const failed: string[] = [];
  const anchor = anchorOf(request);
  let last: string | null = null;
  for (const [index, message] of request.messages.entries()) {
    for (const [at, block] of message.content.entries()) {
      if (block.type !== "thinking" || beforeAnchor(anchor, { at, index })) {
        continue;
      }
      const [before = "", mac = ""] = block.signature.split(".");
      const chained = last === null || before === macPart(last);
      const expected = await macOf(prefixOf(request, { at, index }), block.thinking, before);
      if (chained && mac === expected) {
        last = block.signature;
      } else {
        failed.push(`messages.${String(index)}.content.${String(at)}`);
      }
    }
  }
  return { failed, last };
};
