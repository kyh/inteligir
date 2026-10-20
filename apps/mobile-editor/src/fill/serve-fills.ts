// The page's reader mode, the phone's half of filling a link it saved: each `fillJob` is a page's
// bytes as the phone fetched them, decoded as a browser decodes a page, read by @repo/page-reader
// over this WebView's own DOMParser, and answered by its id. The reader loads nothing: a parsed
// document is inert, and the page's policy refuses every connection (`connect-src 'none'`).

import { decodeText } from "@repo/notes/text/decode-text";
import { extractPage } from "@repo/page-reader/extract-page";
import type { ParsePage } from "@repo/page-reader/extract-page";

import type { PageBridge } from "../bridge/page-bridge";
import type { FillAnswer, FillJob } from "../bridge/protocol";

const bytesOf = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

const browserParse: ParsePage = (html) => new DOMParser().parseFromString(html, "text/html");

// a page that breaks the reader answers `failed`, never an exception the phone waits out
export const readPage = (job: FillJob, parsePage: ParsePage = browserParse): FillAnswer => {
  try {
    const html = decodeText(bytesOf(job.base64), job.charset);
    return { kind: "read", ...extractPage({ html, prefer: job.prefer, url: job.url }, parsePage) };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? `${error.name}: ${error.message}` : "the page was not read",
    };
  }
};

export const serveFills = (bridge: PageBridge): (() => void) =>
  bridge.onNative((event) => {
    if (event.type === "fillJob") {
      bridge.emit({ answer: readPage(event.job), id: event.id, type: "fillAnswer" });
    }
  });
