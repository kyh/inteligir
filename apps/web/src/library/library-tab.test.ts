import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_READ_MS } from "#lib/auth-client";
import type { SessionState } from "#lib/auth-client";
import { signInHref } from "#lib/next-path";

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
// to, where the session stood as it went, and each time it forgot the account's storage
const tabOver = (answers: SessionState[] = []) => {
  const went: string[] = [];
  const wentAs: string[] = [];
  const counts = { forgotten: 0, heard: 0 };
  const tab = createTabSession({
    forget: () => {
      counts.forgotten += 1;
    },
    location: {
      ...HERE,
      assign: (to) => {
        went.push(String(to));
        wentAs.push(tab.store.get().kind);
      },
    },
    read: async () => await Promise.resolve(answers.shift() ?? SIGNED_IN),
  });
  tab.store.subscribe(() => {
    counts.heard += 1;
  });
  return { counts, standing: tab.store.get, tab, went, wentAs };
};

describe("where a tab's session stands", () => {
  it("goes to sign-in once, to come back here, however many calls hear the session end", () => {
    const { counts, standing, tab, went, wentAs } = tabOver();
    tab.end({ kind: "ended", why: "signed-out" });
    tab.end({ kind: "ended", why: "signed-out" });
    tab.end({ kind: "ended", why: "gone" });
    expect(went).toStrictEqual([signInHref(HERE)]);
    // already ended as the page goes, so the browser asks nothing over what the tab still holds
    expect(wentAs).toStrictEqual(["ended"]);
    expect(counts).toStrictEqual({ forgotten: 1, heard: 1 });
    expect(standing()).toStrictEqual({ kind: "ended", why: "signed-out" });
  });

  it("says a browser the floor refused is too old, and keeps its session and its page", () => {
    const { counts, standing, tab, went } = tabOver();
    tab.end({ kind: "ended", why: "outdated" });
    tab.end({ kind: "ended", why: "signed-out" });
    expect(went).toStrictEqual([]);
    expect(counts).toStrictEqual({ forgotten: 0, heard: 1 });
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
      { kind: "unknown" },
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
