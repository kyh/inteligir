import { describe, expect, it } from "vitest";

import { createThreadPreviews } from "./thread-previews";

const THREAD = "0199a4c2-0000-7000-8000-000000000001";
const OTHER = "0199a4c2-0000-7000-8000-000000000002";

describe("the reply being written", () => {
  it("keeps each thread's text apart, telling a screen only when one moved", () => {
    const previews = createThreadPreviews();
    let told = 0;
    const unsubscribe = previews.subscribe(() => {
      told += 1;
    });

    previews.hear({ text: "Filing", threadId: THREAD });
    previews.hear({ text: "Look", threadId: OTHER });
    previews.hear({ text: "Filing", threadId: THREAD });
    expect(previews.get(THREAD)).toBe("Filing");
    expect(previews.get(OTHER)).toBe("Look");
    expect(told).toBe(2);

    previews.hear({ text: null, threadId: THREAD });
    previews.hear({ text: null, threadId: THREAD });
    expect(previews.get(THREAD)).toBeNull();
    expect(previews.get(OTHER)).toBe("Look");
    expect(told).toBe(3);

    unsubscribe();
    previews.hear({ text: "Filed", threadId: THREAD });
    expect(told).toBe(3);
  });

  it("lets every thread's go at once, telling a screen only when one was held", () => {
    const previews = createThreadPreviews();
    let told = 0;
    previews.subscribe(() => {
      told += 1;
    });

    previews.hear({ text: null, threadId: null });
    expect(told).toBe(0);
    previews.hear({ text: "Filing", threadId: THREAD });
    previews.hear({ text: "Look", threadId: OTHER });
    previews.hear({ text: null, threadId: null });
    expect(previews.get(THREAD)).toBeNull();
    expect(previews.get(OTHER)).toBeNull();
    expect(told).toBe(3);
  });
});
