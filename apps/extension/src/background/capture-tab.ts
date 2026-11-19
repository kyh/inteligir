import { FILL_LIMITS } from "@repo/contract/items/link-fill";
import { browser } from "wxt/browser";
import type { PublicPath } from "wxt/browser";

import { capturedPageSchema } from "../capture/captured-page";

const CAPTURE_SCRIPT = "/capture.js" satisfies PublicPath;

const COVER_DEADLINE_MS = 10_000;
export const COVER_TRIES = 8;
export const CAPTURE_DEADLINE_MS = 10_000;

export const captureTab = async (tabId: number) => {
  try {
    const [frame] = await browser.scripting.executeScript({
      files: [CAPTURE_SCRIPT],
      target: { tabId },
    });

    const parsed = capturedPageSchema.safeParse(frame?.result);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const fetchCover = async (url: string) => {
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
