// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import type { CellCall } from "../test-support/fake-page-library";
import { AccountSection } from "./account-section";

afterEach(cleanup);

const device = (id: string, name: string, current: boolean) => ({
  createdAt: 1,
  current,
  id,
  lastSeenAt: null,
  name,
  revokedAt: null,
});

const answer = ({ path }: CellCall): object => {
  switch (path) {
    case "account.devices.list": {
      return {
        devices: [device("mac", "Studio Mac", true), device("phone", "Lost Phone", false)],
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

describe("Settings › Account's devices", () => {
  it("names this Mac on its own row and offers Sign out only on the others", async () => {
    const { library } = fakePageLibrary({ answer });
    renderOnLibrary(<AccountSection />, library);
    const rows = within(await screen.findByRole("list", { name: "Devices" }));
    expect(rows.getByText("This Mac")).toBeDefined();
    expect(rows.queryByRole("button", { name: "Sign out Studio Mac" })).toBeNull();
    expect(rows.getByRole("button", { name: "Sign out Lost Phone" })).toBeDefined();
  });
});
