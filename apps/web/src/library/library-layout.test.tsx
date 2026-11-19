import { V1_RPC_PATH, v1Contract } from "@repo/contract/rpc/v1-contract";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { renderLibraryAt } from "./test-support/library-page.test-utils";

const LOADS_THE_PAGE_MS = 60_000;
const DRAWS_MS = 30_000;

const SIGNED_IN = { user: { email: "owner@example.com", id: "user-1", name: "Owner" } };

const freshTab = async () => {
  vi.resetModules();

  return await import("./library-tab");
};

const openedAt = async (entry: string) => {
  const { pageTab } = await freshTab();
  renderLibraryAt(entry, await pageTab.opening);
};

const network = setupServer();

beforeAll(() => {
  network.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  network.resetHandlers();
});

afterAll(() => {
  network.close();
});

const SESSION_READ = "*/api/auth/get-session";

describe("the tab's open", () => {
  it(
    "says the library didn't open and offers Try again when its session read met no answer",
    async () => {
      network.use(http.all("*", () => HttpResponse.error()));
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

      network.use(
        http.all(SESSION_READ, () => {
          sessionReads += 1;

          return HttpResponse.json(SIGNED_IN);
        }),
        http.all("*", () => HttpResponse.json(SIGNED_IN)),
      );
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
      network.use(
        http.all(SESSION_READ, () => HttpResponse.json(SIGNED_IN)),
        http.all(`*${V1_RPC_PATH}/*`, async ({ request }) => {
          const { response } = await floor.handle(request, { prefix: V1_RPC_PATH });

          return response ?? new HttpResponse(null, { status: 404 });
        }),
      );
      await openedAt("/library");

      const said = await screen.findByText(/This browser is too old/u, undefined, {
        timeout: DRAWS_MS,
      });

      expect(said).toBe(document.querySelector("[data-library]"));
    },
    LOADS_THE_PAGE_MS,
  );
});
