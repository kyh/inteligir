// The page nothing shows, the phone's one place that runs the editor's code with no editor drawn.
// A `fillJob` is a page the phone shared and fetched itself, decoded as a browser decodes a page,
// read by @repo/page-reader over this WebView's own DOMParser and answered as the item's article
// blocks, in order. A `mergeJob` is a block two devices changed, which the phone's replica settles
// a CONFLICT through: the editor's own diff3 over each side's markdown answers it. The page loads
// nothing: a parsed document is inert, and its policy refuses every connection
// (`connect-src 'none'`).

import { mergeBlocks } from "@repo/editor/stale-write";
import { ordsBetween } from "@repo/notes/library/block-order";
import { decodeText } from "@repo/notes/text/decode-text";
import { extractPageBlocks } from "@repo/page-reader/extract-page";
import type { ParsePage } from "@repo/page-reader/extract-page";

import type { PageBridge } from "../bridge/page-bridge";
import type { FillAnswer, FillJob, MergeAnswer, MergeSides } from "@repo/editor-bridge/protocol";

const bytesOf = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

const browserParse: ParsePage = (html) => new DOMParser().parseFromString(html, "text/html");

// a block's id, minted from the WebView's random source: a page loaded from file:// is no secure
// context, so it has no randomUUID
const browserBlockId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

// a page that breaks the reader answers `failed`, never an exception the phone waits out
/** @internal */
export const readPage = (
  job: FillJob,
  parsePage: ParsePage = browserParse,
  newBlockId: () => string = browserBlockId,
): FillAnswer => {
  try {
    const html = decodeText(bytesOf(job.base64), job.charset);
    const read = extractPageBlocks(
      { html, prefer: job.prefer, url: job.url },
      parsePage,
      newBlockId,
    );
    const ords = ordsBetween(null, null, read.article.blocks.length);
    return {
      article: read.article.blocks.flatMap(({ block }, index) => {
        const ord = ords[index];
        return ord === undefined ? [] : [{ block, ord }];
      }),
      facts: read.facts,
      kind: "read",
      kept: read.kept,
      rung: read.rung,
    };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? `${error.name}: ${error.message}` : "the page was not read",
    };
  }
};

// the editor's merge of a block two devices changed; null for a merge that broke on the way
/** @internal */
export const mergeSides = (sides: MergeSides): MergeAnswer => {
  try {
    return mergeBlocks(sides);
  } catch {
    return null;
  }
};

export const serveHeadless = (bridge: PageBridge): (() => void) =>
  bridge.onNative((event) => {
    if (event.type === "fillJob") {
      bridge.emit({ answer: readPage(event.job), id: event.id, type: "fillAnswer" });
      return;
    }
    if (event.type === "mergeJob") {
      bridge.emit({ id: event.id, merged: mergeSides(event.sides), type: "mergeAnswer" });
    }
  });
