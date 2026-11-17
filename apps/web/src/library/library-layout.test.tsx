import { V1_RPC_PATH, v1Contract } from "@repo/contract/rpc/v1-contract";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderLibraryAt } from "./test-support/library-page";

// the tab's open is the whole library and its first read, loaded fresh each test
const LOADS_THE_PAGE_MS = 60_000;
// the refusal answers the first read of the library
const DRAWS_MS = 30_000;

const SIGNED_IN = { user: { email: "owner@example.com", id: "user-1", name: "Owner" } };

// the tab opens once a document, so each test opens a fresh one
const freshTab = async () => {
  vi.resetModules();
  return await import("./library-tab");
};

const openedAt = async (entry: string): Promise<void> => {
  const { pageTab } = await freshTab();
  renderLibraryAt(entry, await pageTab.opening);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tab's open", () => {
  it(
    "says the library didn't open and offers Try again when its session read met no answer",
    async () => {
      vi.stubGlobal("fetch", async () => await Promise.reject(new TypeError("Failed to fetch")));
      await openedAt("/library");
      await screen.findByRole("heading", { name: "Your library didn't open" });
      expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    },
    LOADS_THE_PAGE_MS,
  );

  it(
    "reads the session and makes the library once a document, however often the page asks",
    async () => {
      let sessionReads = 0;
      // the session is read by url, and the library's first read is a call to /v1
      vi.stubGlobal("fetch", async (input: Request | string | URL) => {
        if (!(input instanceof Request)) {
          sessionReads += 1;
        }
        await Promise.resolve();
        return Response.json(SIGNED_IN);
      });
      const { pageTab } = await freshTab();
      const first = await pageTab.opening;
      const second = await pageTab.opening;
      expect(second).toBe(first);
      expect(first.kind).toBe("open");
      expect(sessionReads).toBe(1);
    },
    LOADS_THE_PAGE_MS,
  );
});

describe("a tab the build floor refuses", () => {
  // a browser that doesn't mark its calls same-origin: signed in, and refused at the floor
  const os = implement(v1Contract);
  const floor = new RPCHandler({
    library: {
      listing: {
        scopes: os.library.listing.scopes.handler(({ errors }) => {
          throw errors.CLIENT_OUTDATED();
        }),
      },
    },
  });

  it(
    "says the browser is too old, since a sign-in would send it straight back here",
    async () => {
      vi.stubGlobal("fetch", async (input: Request | string | URL) => {
        if (!(input instanceof Request)) {
          return Response.json(SIGNED_IN);
        }
        const { response } = await floor.handle(input, { prefix: V1_RPC_PATH });
        return response ?? new Response(null, { status: 404 });
      });
      await openedAt("/library");
      const said = await screen.findByText(/This browser is too old/u, undefined, {
        timeout: DRAWS_MS,
      });
      expect(said).toBe(document.querySelector("[data-library]"));
    },
    LOADS_THE_PAGE_MS,
  );
});
