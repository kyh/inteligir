// the browser's side of a save: the capture script injected into the tab and its page read back,
// and a cover candidate's bytes fetched as this browser fetches a picture, with no cookie, so the
// site sees no session of the person's in it.

import { FILL_LIMITS } from "@repo/notes/items/link-fill";
import { browser } from "wxt/browser";
import type { PublicPath } from "wxt/browser";

import { CAPTURE_OPTIONS, capturedPageSchema } from "../capture/captured-page";
import type { CaptureOptions, CapturedPage } from "../capture/captured-page";

// src/entrypoints/capture.ts, which WXT writes at this path and types as one of its own
const CAPTURE_SCRIPT = "/capture.js" satisfies PublicPath;

// a cover candidate's fetch, and how many candidates a save fetches at most (the reader names no
// more): together the longest a save's search for its cover runs (./save-queue)
export const COVER_DEADLINE_MS = 10_000;
export const COVER_TRIES = 8;
// the longest a save waits on the tab's own capture, which a page still loading or a main thread
// stuck in a script never answers (./save-page)
export const CAPTURE_DEADLINE_MS = 10_000;

// null when the tab cannot be scripted, or answered something that is not a captured page
export const captureTab = async (tabId: number): Promise<CapturedPage | null> => {
  try {
    await browser.scripting.executeScript({ files: [CAPTURE_SCRIPT], target: { tabId } });
    // the function crosses into the page as its source text, so it names nothing outside itself
    const [frame] = await browser.scripting.executeScript({
      args: [CAPTURE_OPTIONS],
      func: (options: CaptureOptions) => window.inteligirCapture?.(options) ?? null,
      target: { tabId },
    });
    const parsed = capturedPageSchema.safeParse(frame?.result);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// a candidate's bytes, read no further than a cover's cap; null for one that did not answer, was
// not let read across origins, or is larger than any cover
export const fetchCover = async (url: string): Promise<Uint8Array<ArrayBuffer> | null> => {
  try {
    const response = await fetch(url, {
      credentials: "omit",
      signal: AbortSignal.timeout(COVER_DEADLINE_MS),
    });
    if (!response.ok || response.body === null) {
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      length += read.value.length;
      if (length > FILL_LIMITS.coverBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(read.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } catch {
    return null;
  }
};
