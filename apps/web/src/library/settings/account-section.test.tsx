import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { PageLibrary } from "../cloud/library-context";
import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library.test-utils";
import type { CellCall } from "../test-support/fake-page-library.test-utils";
import { AccountSection } from "./account-section";

const { betterAuth, network } = await vi.hoisted(async () => {
  const { http, HttpResponse } = await import("msw");
  const { setupServer } = await import("msw/node");
  const asked: string[] = [];
  const held = { asked, status: 200 };

  const server = setupServer(
    http.all("*/api/auth/*", ({ request }) => {
      held.asked.push(`${request.method} ${new URL(request.url).pathname}`);

      return HttpResponse.json({ success: held.status === 200 }, { status: held.status });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  return { betterAuth: held, network: server };
});

afterAll(() => {
  network.close();
});

const device = (id: string, name: string, current: boolean) => ({
  createdAt: 1,
  current,
  id,
  lastSeenAt: 1,
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

const signingOut = (status: number) => {
  betterAuth.status = status;
  betterAuth.asked.length = 0;
  const leaves: string[] = [];

  const left: PageLibrary["left"] = (reason) => {
    leaves.push(reason);
  };

  return { asked: betterAuth.asked, leaves, left };
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
  it("ends this session at Better Auth, then leaves for the sign-in", async () => {
    const { library } = fakePageLibrary({ answer });
    const { asked, leaves, left } = signingOut(200);
    renderOnLibrary(<AccountSection />, { ...library, left });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(leaves).toStrictEqual(["signed-out"]);
    });
    expect(asked).toStrictEqual(["POST /api/auth/sign-out"]);
  });

  it("stays on the page when Better Auth refuses it", async () => {
    const { library } = fakePageLibrary({ answer });
    const { asked, leaves, left } = signingOut(500);
    renderOnLibrary(<AccountSection />, { ...library, left });
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
