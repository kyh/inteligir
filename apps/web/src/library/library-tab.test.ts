import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_READ_MS, signInHref } from "#lib/auth-client";
import type { SessionState } from "#lib/auth-client";

import { createTabSession } from "./library-tab";

const HERE = { pathname: "/library", search: "?item=0199a4c2-0000-7000-8000-0000000000e1" };
const SIGNED_IN: SessionState = {
  kind: "signed-in",
  user: { email: "person@example.com", id: "u1", name: "" },
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// a tab's session, the keeper's reads answered in turn and then signed in, with each page it went
// to and each time it dropped its guard or forgot the account's storage
const tabOver = (answers: SessionState[] = []) => {
  const went: string[] = [];
  const counts = { dropped: 0, forgotten: 0, heard: 0 };
  const tab = createTabSession({
    forget: () => {
      counts.forgotten += 1;
    },
    guard: {
      drop: () => {
        counts.dropped += 1;
      },
    },
    location: {
      ...HERE,
      assign: (to) => {
        went.push(String(to));
      },
    },
    read: async () => await Promise.resolve(answers.shift() ?? SIGNED_IN),
  });
  tab.store.subscribe(() => {
    counts.heard += 1;
  });
  return { counts, standing: tab.store.get, tab, went };
};

describe("where a tab's session stands", () => {
  it("goes to sign-in once, to come back here, however many calls hear the session end", () => {
    const { counts, standing, tab, went } = tabOver();
    tab.end({ kind: "ended", why: "signed-out" });
    tab.end({ kind: "ended", why: "signed-out" });
    tab.end({ kind: "ended", why: "gone" });
    expect(went).toStrictEqual([signInHref(HERE)]);
    expect(counts).toStrictEqual({ dropped: 1, forgotten: 1, heard: 1 });
    expect(standing()).toStrictEqual({ kind: "ended", why: "signed-out" });
  });

  it("says a browser the floor refused is too old, and keeps its session and its page", () => {
    const { counts, standing, tab, went } = tabOver();
    tab.end({ kind: "ended", why: "outdated" });
    tab.end({ kind: "ended", why: "signed-out" });
    expect(went).toStrictEqual([]);
    expect(counts).toStrictEqual({ dropped: 1, forgotten: 0, heard: 1 });
    expect(standing()).toStrictEqual({ kind: "ended", why: "outdated" });
  });

  it("goes home once the account is deleted, whatever end is heard after", () => {
    const { standing, tab, went } = tabOver();
    tab.end({ kind: "left", why: "deleted" });
    tab.end({ kind: "ended", why: "signed-out" });
    expect(went).toStrictEqual(["/"]);
    expect(standing()).toStrictEqual({ kind: "left" });
  });

  it("makes a leave do nothing once the session has ended", () => {
    const { counts, tab, went } = tabOver();
    tab.end({ kind: "ended", why: "signed-out" });
    tab.end({ kind: "left", why: "signed-out" });
    expect(went).toStrictEqual([signInHref(HERE)]);
    expect(counts.forgotten).toBe(1);
  });

  it("finds out at the keeper's read that the session ended elsewhere, and leaves once", async () => {
    const { standing, went } = tabOver([
      { kind: "unknown", message: "Something went wrong — try again." },
      { kind: "signed-out" },
      { kind: "signed-out" },
    ]);
    await vi.advanceTimersByTimeAsync(SESSION_READ_MS);
    expect(standing()).toStrictEqual({ kind: "live" });

    await vi.advanceTimersByTimeAsync(SESSION_READ_MS);
    expect(went).toStrictEqual([signInHref(HERE)]);
    await vi.advanceTimersByTimeAsync(SESSION_READ_MS);
    expect(went).toHaveLength(1);
  });
});
