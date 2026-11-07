// @vitest-environment jsdom

import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { headingCollapseKeys, toggleHeadingCollapse } from "@repo/editor/heading-collapse";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PREFS, readPref, writePref } from "../prefs";
import { forgetAccountStorage } from "./account-storage";
import { createLeaveGuard } from "./leave-guard";
import { openPageLibrary, pageClock } from "./page-library";
import { SESSION_READ_MS } from "./session-keeper";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  forgetAccountStorage();
});

const ORIGIN = "https://cell.test";
const SIGNED_IN = { user: { email: "owner@example.com", name: "Owner" } };

const remembered = (): void => {
  writePref(PREFS.libraryScope, { kind: "tag", tag: "field" });
  toggleHeadingCollapse("item-1", "a-fold");
};

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

  it("lets go of what the page's own storage holds, the session having ended with no tab open", async () => {
    vi.stubGlobal("fetch", async () => await Promise.resolve(Response.json(null)));
    remembered();
    await openPageLibrary(ORIGIN, {
      leave: createLeaveGuard(new EventTarget()),
      onSessionEnd: () => {},
    });
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "all" });
    expect([...headingCollapseKeys("item-1")]).toStrictEqual([]);
  });

  it("keeps it through a fault of the site's, which says no session ended", async () => {
    vi.stubGlobal("fetch", async () => await Promise.resolve(new Response(null, { status: 503 })));
    remembered();
    await expect(
      openPageLibrary(ORIGIN, {
        leave: createLeaveGuard(new EventTarget()),
        onSessionEnd: () => {},
      }),
    ).rejects.toThrow("the session read answered 503");
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "tag", tag: "field" });
    expect([...headingCollapseKeys("item-1")]).toStrictEqual(["a-fold"]);
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
    remembered();
    await replica.sync();
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "tag", tag: "field" });

    cell.signOut();
    await replica.sync();
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "all" });
    expect([...headingCollapseKeys("item-1")]).toStrictEqual([]);
    await replica.close();
  });

  it("keeps it below the build floor, where the session stands", async () => {
    const os = implement(v1Contract);
    const cloud = new RPCHandler({
      library: {
        sync: {
          pull: os.library.sync.pull.handler(({ errors }) => {
            throw errors.CLIENT_OUTDATED();
          }),
        },
      },
    });
    vi.stubGlobal("fetch", async (input: Request | string) => {
      if (!(input instanceof Request)) {
        return Response.json(SIGNED_IN);
      }
      const { response } = await cloud.handle(input, { prefix: V1_RPC_PATH });
      return response ?? new Response(null, { status: 404 });
    });
    const onSessionEnd = vi.fn<() => void>();
    const { replica } = await opened(onSessionEnd);
    remembered();

    await replica.sync();
    expect(replica.status().failure).toStrictEqual({ end: "outdated", kind: "session" });
    expect(onSessionEnd).toHaveBeenCalledOnce();
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "tag", tag: "field" });
    expect([...headingCollapseKeys("item-1")]).toStrictEqual(["a-fold"]);
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
    remembered();
    await left("signed-out");
    expect(readPref(PREFS.libraryScope)).toStrictEqual({ kind: "all" });
    expect([...headingCollapseKeys("item-1")]).toStrictEqual([]);
    await replica.close();
  });
});
