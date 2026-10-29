// The fake's thinking signatures, bound as Claude Opus 5.5 binds a replayed thinking block: to the
// request's system, its tools and every message before the block, compared as the API compares
// them (`./fake-request.ts` `prefixOf`), and chained to the thinking block before it. So a request
// that leaves out a leading run of thinking blocks still verifies, and any other edit, a block
// removed from the middle included, fails from the edit on
// (platform.claude.com/docs/en/build-with-claude/preserved-thinking). A signature is the previous
// block's mac and the block's own: an HMAC over its prefix, its text and that previous mac.

import { prefixOf } from "./fake-request.ts";
import type { FakeRequest } from "./fake-request.ts";

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

const hex = (bytes: ArrayBuffer): string =>
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

// the signature of the thinking block that opens the fake's reply to `request`, the thinking block
// before it in the conversation signed `previous`: bound as the next request will carry it, the
// reply an assistant message after every message sent
export const signThinking = async (
  request: FakeRequest,
  thinking: string,
  previous: string | null,
): Promise<string> => {
  const before = previous === null ? NO_PREVIOUS : macPart(previous);
  const answered = {
    ...request,
    messages: [...request.messages, { content: [], role: "assistant" as const }],
  };
  const prefix = prefixOf(answered, { at: 0, index: request.messages.length });
  return `${before}.${await macOf(prefix, thinking, before)}`;
};

export interface ThinkingCheck {
  // the paths, as the API names them, of the blocks that do not verify, in order
  readonly failed: readonly string[];
  // the signature of the last block that verified, which the reply's own chains to
  readonly last: string | null;
}

// every replayed thinking block checked in order; one that fails is left out, so the blocks after
// an edit fail with it
export const checkThinking = async (request: FakeRequest): Promise<ThinkingCheck> => {
  const failed: string[] = [];
  let last: string | null = null;
  for (const [index, message] of request.messages.entries()) {
    for (const [at, block] of message.content.entries()) {
      if (block.type !== "thinking") {
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
