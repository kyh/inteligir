import { describe, expect, it } from "vitest";

import { createThreadPreviews, previewOf } from "./thread-previews";
import type { ThreadFrame } from "./thread-previews";

const THREAD = "0199a4c2-0000-7000-8000-000000000001";
const OTHER = "0199a4c2-0000-7000-8000-000000000002";

const preview = (threadId: string, text: string): ThreadFrame => ({
  event: { text, type: "agent.preview" },
  preview: true,
  threadId,
  type: "thread",
});

const stored = (threadId: string): ThreadFrame => ({
  event: { text: "Done.", type: "agent.message" },
  preview: false,
  threadId,
  type: "thread",
});

// a socket the test speaks for, as the replica's onThreadFrame hands frames on
const socket = () => {
  const listeners = new Set<(frame: ThreadFrame) => void>();
  return {
    hear: (frame: ThreadFrame) => {
      for (const listener of listeners) {
        listener(frame);
      }
    },
    listeners,
    onThreadFrame: (listener: (frame: ThreadFrame) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

describe("the reply being written", () => {
  it("reads a preview's text, and lets it go at the thread's next stored event", () => {
    expect(previewOf(preview(THREAD, "Fil"))).toEqual({ text: "Fil", threadId: THREAD });
    expect(previewOf(stored(THREAD))).toEqual({ text: null, threadId: THREAD });
  });

  it("changes nothing for a preview this build cannot read", () => {
    expect(previewOf({ ...preview(THREAD, "x"), event: { kind: "later" } })).toBeNull();
  });

  it("keeps each thread's text apart, telling a screen only when one moved", () => {
    const heard = socket();
    const previews = createThreadPreviews(heard.onThreadFrame);
    let told = 0;
    const unsubscribe = previews.subscribe(() => {
      told += 1;
    });

    heard.hear(preview(THREAD, "Filing"));
    heard.hear(preview(OTHER, "Look"));
    heard.hear(preview(THREAD, "Filing"));
    expect(previews.get(THREAD)).toBe("Filing");
    expect(previews.get(OTHER)).toBe("Look");
    expect(told).toBe(2);

    heard.hear(stored(THREAD));
    heard.hear(stored(THREAD));
    expect(previews.get(THREAD)).toBeNull();
    expect(previews.get(OTHER)).toBe("Look");
    expect(told).toBe(3);

    unsubscribe();
    previews.stop();
    expect(heard.listeners.size).toBe(0);
  });
});
