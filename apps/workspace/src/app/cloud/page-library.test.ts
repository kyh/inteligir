// @vitest-environment jsdom

import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PREFS, readPref, writePref } from "../prefs";
import { createLeaveGuard } from "./leave-guard";
import { openPageLibrary, pageClock } from "./page-library";
import { SESSION_READ_MS } from "./session-keeper";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ORIGIN = "https://cell.test";
const SIGNED_IN = { user: { email: "owner@example.com", name: "Owner" } };

const opened = async (onSessionEnd: () => void) => {
  const opening = await openPageLibrary(ORIGIN, {
    leave: createLeaveGuard(new EventTarget()),
    onSessionEnd,
  });
  if (opening.kind !== "ready") {
    throw new Error(`the library did not open: ${opening.kind}`);
  }
  return opening.library;
};

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
    expect(answerSession).toHaveBeenCalledOnce();

    waiting.find(({ ms }) => ms === SESSION_READ_MS)?.run();
    expect(answerSession).toHaveBeenCalledTimes(2);
    expect(answerSession).toHaveBeenLastCalledWith(`${ORIGIN}/api/auth/get-session`, {
      credentials: "same-origin",
    });

    await opening.library.replica.close();
  });
});

describe("reading the session the tab opens on", () => {
  it.each([
    ["names no session", async () => await Promise.resolve(Response.json(null))],
    ["was refused as over", async () => await Promise.resolve(new Response(null, { status: 401 }))],
  ])("goes to the site's sign-in when the site's answer %s", async (_case, answer) => {
    vi.stubGlobal("fetch", answer);
    await expect(
      openPageLibrary(ORIGIN, {
        leave: createLeaveGuard(new EventTarget()),
        onSessionEnd: () => {},
      }),
    ).resolves.toStrictEqual({ kind: "signed-out" });
  });

  it("never reads a fault of the site's as signed out", async () => {
    vi.stubGlobal("fetch", async () => await Promise.resolve(new Response(null, { status: 503 })));
    await expect(
      openPageLibrary(ORIGIN, {
        leave: createLeaveGuard(new EventTarget()),
        onSessionEnd: () => {},
      }),
    ).rejects.toThrow("the session read answered 503");
  });
});

describe("a session that ends under the open page", () => {
  it("sends the tab to sign in when the replica is the one that meets it", async () => {
    const cell = createFakeCell();
    const { transport } = cell.device("tab");
    // the Worker as the tab reaches it: the session's read by its address, and `/v1` from the cell
    vi.stubGlobal("fetch", async (input: Request | string) =>
      input instanceof Request ? await transport.fetch(input) : Response.json(SIGNED_IN),
    );
    const onSessionEnd = vi.fn<() => void>();
    const { replica } = await opened(onSessionEnd);
    await replica.sync();
    expect(onSessionEnd).not.toHaveBeenCalled();

    cell.signOut();
    await replica.sync();
    expect(onSessionEnd).toHaveBeenCalledOnce();

    // what moves after, a write queued as the page goes, is no second end
    await replica.saveLink({ folderId: null, tags: [], url: "https://example.com/" });
    expect(onSessionEnd).toHaveBeenCalledOnce();
    await replica.close();
  });

  it("takes what the page's own storage holds of the account with it", async () => {
    const cell = createFakeCell();
    const { transport } = cell.device("tab");
    vi.stubGlobal("fetch", async (input: Request | string) =>
      input instanceof Request ? await transport.fetch(input) : Response.json(SIGNED_IN),
    );
    const { replica } = await opened(() => {});
    writePref(PREFS.libraryScope, { kind: "tag", tag: "field" });
    localStorage.setItem("inteligir.collapsed-headings", '{"item-1":["a-fold"]}');
    await replica.sync();
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "tag", tag: "field" });

    cell.signOut();
    await replica.sync();
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "all" });
    expect(localStorage.getItem("inteligir.collapsed-headings")).toBeNull();
    await replica.close();
  });
});

describe("a tab that leaves its account", () => {
  it("takes what the page's own storage holds of the account with it", async () => {
    const cell = createFakeCell();
    const { transport } = cell.device("tab");
    vi.stubGlobal("fetch", async (input: Request | string) =>
      input instanceof Request ? await transport.fetch(input) : Response.json(SIGNED_IN),
    );
    const { left, replica } = await opened(() => {});
    writePref(PREFS.libraryScope, { kind: "tag", tag: "field" });
    localStorage.setItem("inteligir.collapsed-headings", '{"item-1":["a-fold"]}');
    await left("signed-out");
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "all" });
    expect(localStorage.getItem("inteligir.collapsed-headings")).toBeNull();
    await replica.close();
  });
});
