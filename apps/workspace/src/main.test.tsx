// @vitest-environment jsdom

import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { openMemorySql } from "@repo/library-replica/memory-sql";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP_COMMANDS } from "./shell/ipc-contract";
import type { KeptCredential, ShellConfig } from "./shell/shell-config";
import { clearShell, mockShell, replicaReplies, reply } from "./shell/test-support/mock-shell";

// main.tsx is the whole page and its top-level await, loaded once a test
const LOADS_THE_PAGE_MS = 60_000;
// the library draws before its replica's first pass answers
const DRAWS_MS = 30_000;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `<div id="root"></div>`;
});

afterEach(() => {
  clearShell();
  vi.unstubAllGlobals();
  window.location.hash = "";
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
          return Response.json({
            user: { email: "owner@example.com", id: "user-1", name: "Owner" },
          });
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

describe("a Mac that lands signed out", () => {
  const CONFIG: ShellConfig = {
    cloudOrigin: "http://localhost:5174",
    deviceName: "Studio Mac",
    filesOrigin: "inteligir-files://localhost",
    version: "0.6.0",
  };
  const NEXT_ACCOUNT: KeptCredential = {
    credential: `igd_${"b".repeat(64)}`,
    email: "next@example.com",
    userId: "user-2",
  };
  const LAST_ACCOUNTS_ITEM = "0199a4c2-0000-7000-8000-0000000000b1";

  const opensWith = (kept: KeptCredential | null, ...replies: Parameters<typeof mockShell>) => {
    mockShell(
      reply(APP_COMMANDS.config)(() => CONFIG),
      reply(APP_COMMANDS.credential.restore)(() => kept),
      ...replies,
    );
  };

  it(
    "drops the route it left from, so the next sign-in opens on the library",
    async () => {
      // the one Sign out sits in Settings, and a sign-out, a revoke and a deleted account all
      // reload onto a Mac that holds no credential
      window.location.hash = `#/settings?item=${LAST_ACCOUNTS_ITEM}`;
      opensWith(null);
      await import("./main");
      await screen.findByRole("heading", { name: "Sign in to your library" });
      expect(window.location.hash).toBe("");

      // the sign-in's own reload, onto the credential it kept
      vi.resetModules();
      document.body.innerHTML = `<div id="root"></div>`;
      vi.stubGlobal("fetch", async () => await Promise.reject(new TypeError("Failed to fetch")));
      opensWith(NEXT_ACCOUNT, ...replicaReplies(await openMemorySql()));
      await import("./main");
      await screen.findByRole("heading", { name: "All items" }, { timeout: DRAWS_MS });
    },
    2 * LOADS_THE_PAGE_MS,
  );
});
