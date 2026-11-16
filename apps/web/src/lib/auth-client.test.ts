import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activeSession, keepSession, SESSION_READ_MS } from "./auth-client";

// the client settles its base and its fetch as it loads, so both are in place first
const cloud = vi.hoisted(() => {
  const answers = { getSession: async (): Promise<Response> => Response.json(null) };
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  vi.stubGlobal("fetch", async () => await answers.getSession());
  return answers;
});

const answering = (status: number) => async () => Response.json(null, { status });

const offline = async (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("reading who is signed in", () => {
  it.each([
    ["no session", answering(200), "signed-out"],
    ["a session lost as it was read", answering(401), "signed-out"],
    ["a fault of the site's", answering(500), "unknown"],
    ["no network", offline, "unknown"],
  ])("reads %s as its own answer, and never rejects", async (_case, getSession, kind) => {
    cloud.getSession = getSession;
    await expect(activeSession()).resolves.toStrictEqual({ kind });
  });
});

describe("keeping a tab's session", () => {
  it("reads it inside the day a session waits to slide, and keeps reading", async () => {
    const read = vi.fn<() => Promise<void>>(async () => {
      await Promise.resolve();
    });
    keepSession(read);
    expect(read).not.toHaveBeenCalled();
    expect(SESSION_READ_MS).toBeLessThan(86_400_000);

    await vi.advanceTimersByTimeAsync(2 * SESSION_READ_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
