// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createPageAuth } from "../cloud/auth-client";
import type { PageLibrary } from "../cloud/library-context";
import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import type { CellCall } from "../test-support/fake-page-library";
import { AccountSection } from "./account-section";

afterEach(cleanup);

const ORIGIN = "https://library.test";

const device = (id: string, name: string, current: boolean) => ({
  createdAt: 1,
  current,
  id,
  lastSeenAt: null,
  name,
});

const answer = ({ path }: CellCall) => {
  switch (path) {
    case "account.devices.list": {
      return {
        devices: [device("s-mac", "Safari on Mac", true), device("s-phone", "iPhone", false)],
      };
    }
    case "account.assistants.list": {
      return { assistants: [] };
    }
    default: {
      return { enabled: false, resetsAt: 0, turnsLeft: 0 };
    }
  }
};

// the page's own Better Auth, its calls answered by the suite with `status`, each one recorded, and
// where the page went once it left
const signingOut = (status: number) => {
  const asked: Request[] = [];
  const leaves: string[] = [];
  const auth = createPageAuth({
    fetch: async (request) => {
      asked.push(request);
      return await Promise.resolve(Response.json({ success: status === 200 }, { status }));
    },
    origin: ORIGIN,
  });
  const left: PageLibrary["left"] = (reason) => {
    leaves.push(reason);
  };
  return { asked, auth, leaves, left };
};

describe("Settings › Account's devices", () => {
  it("names this device on its own row and offers Sign out only on the others", async () => {
    const { library } = fakePageLibrary({ answer });
    renderOnLibrary(<AccountSection />, library);
    const rows = within(await screen.findByRole("list", { name: "Devices" }));
    expect(rows.getByText("This device")).toBeDefined();
    expect(rows.queryByRole("button", { name: "Sign out Safari on Mac" })).toBeNull();
    expect(rows.getByRole("button", { name: "Sign out iPhone" })).toBeDefined();
  });

  it("signs another device out by its session's id, and reads the list again", async () => {
    const { calls, library } = fakePageLibrary({ answer });
    renderOnLibrary(<AccountSection />, library);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out iPhone" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "account.devices.list")).toHaveLength(2);
    });
    expect(calls.filter((call) => call.path === "account.devices.revoke")).toStrictEqual([
      { input: { id: "s-phone" }, path: "account.devices.revoke" },
    ]);
  });
});

describe("Settings › Account's Sign out", () => {
  it("ends this session at Better Auth, never through the cell, then leaves for the sign-in", async () => {
    const { calls, library } = fakePageLibrary({ answer });
    const { asked, auth, leaves, left } = signingOut(200);
    renderOnLibrary(<AccountSection />, { ...library, auth, left });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(leaves).toStrictEqual(["signed-out"]);
    });
    expect(asked.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `POST ${ORIGIN}/api/auth/sign-out`,
    ]);
    expect(calls.map((call) => call.path)).not.toContain("account.signOut");
  });

  it("stays on the page when Better Auth refuses it", async () => {
    const { library } = fakePageLibrary({ answer });
    const { asked, auth, leaves, left } = signingOut(500);
    renderOnLibrary(<AccountSection />, { ...library, auth, left });
    const signOut = await screen.findByRole("button", { name: "Sign out" });
    fireEvent.click(signOut);
    await waitFor(() => {
      expect(asked).toHaveLength(1);
    });
    await waitFor(() => {
      expect(signOut.hasAttribute("disabled")).toBe(false);
    });
    expect(leaves).toStrictEqual([]);
  });
});
