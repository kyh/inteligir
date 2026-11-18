import { HttpResponse } from "msw";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activeSession, keepSession, SESSION_READ_MS } from "./auth-client";

const { cloud, network } = await vi.hoisted(async () => {
  const { http } = await import("msw");
  const { setupServer } = await import("msw/node");
  const answers = { getSession: async () => Response.json(null) };
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  const server = setupServer(http.all("*", async () => await answers.getSession()));
  server.listen({ onUnhandledRequest: "error" });

  return { cloud: answers, network: server };
});

afterAll(() => {
  network.close();
});

const answering = (status: number) => async () => Response.json(null, { status });

const offline = async () => await Promise.resolve(HttpResponse.error());

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
    let reads = 0;

    keepSession(async () => {
      reads += 1;
      await Promise.resolve();
    });
    expect(reads).toBe(0);
    expect(SESSION_READ_MS).toBeLessThan(86_400_000);

    await vi.advanceTimersByTimeAsync(2 * SESSION_READ_MS);
    expect(reads).toBe(2);
  });
});
