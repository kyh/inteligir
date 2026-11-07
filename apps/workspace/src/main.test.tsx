// @vitest-environment jsdom

import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// main.tsx is the whole page and its top-level await, loaded once a test
const LOADS_THE_PAGE_MS = 60_000;
// the library draws before its replica's first pass answers
const DRAWS_MS = 30_000;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `<div id="root"></div>`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tab's open", () => {
  it(
    "says the library didn't open and offers Try again when its session read met no answer",
    async () => {
      vi.stubGlobal("fetch", async () => await Promise.reject(new TypeError("Failed to fetch")));
      await import("./main");
      await screen.findByRole("heading", { name: "Your library didn't open" });
      expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    },
    LOADS_THE_PAGE_MS,
  );
});

describe("a tab the build floor refuses", () => {
  // a browser that doesn't mark its calls same-origin: signed in, and refused at the floor
  const os = implement(v1Contract);
  const floor = new RPCHandler({
    library: {
      sync: {
        pull: os.library.sync.pull.handler(({ errors }) => {
          throw errors.CLIENT_OUTDATED();
        }),
      },
    },
  });

  it(
    "says the browser is too old, since a sign-in would send it straight back here",
    async () => {
      vi.stubGlobal("fetch", async (input: Request | string) => {
        if (!(input instanceof Request)) {
          return Response.json({ user: { email: "owner@example.com", name: "Owner" } });
        }
        const { response } = await floor.handle(input, { prefix: V1_RPC_PATH });
        return response ?? new Response(null, { status: 404 });
      });
      await import("./main");
      const said = await screen.findByText(/This browser is too old/u, undefined, {
        timeout: DRAWS_MS,
      });
      expect(said).toBe(document.querySelector("#root"));
    },
    LOADS_THE_PAGE_MS,
  );
});
