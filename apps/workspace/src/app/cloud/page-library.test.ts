import { afterEach, describe, expect, it, vi } from "vitest";

import { createLeaveGuard } from "./leave-guard";
import { openPageLibrary, pageClock } from "./page-library";
import { SESSION_READ_MS } from "./session-keeper";

const ORIGIN = "https://library.test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the tab's library", () => {
  it("reads its session again on the keeper's wait, past the read it opened with", async () => {
    const answerSession = vi.fn<(url: string) => Promise<Response>>(async () => {
      await Promise.resolve();
      return Response.json({ user: { email: "owner@example.com", name: "Owner" } });
    });
    vi.stubGlobal("fetch", answerSession);
    const waiting: { readonly ms: number; readonly run: () => void }[] = [];
    vi.spyOn(pageClock, "after").mockImplementation((ms, run) => {
      waiting.push({ ms, run });
      return () => {};
    });

    const opening = await openPageLibrary(ORIGIN, {
      leave: createLeaveGuard(new EventTarget()),
      onSessionEnd: () => {},
    });
    if (opening.kind !== "ready") {
      throw new Error(`the library did not open: ${opening.kind}`);
    }
    expect(answerSession).toHaveBeenCalledTimes(1);

    waiting.find(({ ms }) => ms === SESSION_READ_MS)?.run();
    expect(answerSession).toHaveBeenCalledTimes(2);
    expect(answerSession).toHaveBeenLastCalledWith(`${ORIGIN}/api/auth/get-session`, {
      credentials: "same-origin",
    });

    await opening.library.replica.close();
  });
});
