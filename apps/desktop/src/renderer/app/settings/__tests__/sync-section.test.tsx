// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { afterEach, describe, expect, it } from "vitest";
import { RevokeFailedNotice, SignedInDetails } from "../sync-section";

afterEach(cleanup);

const NOW_MS = 1_756_600_000_000;

const SIGNED_IN: Extract<CloudStatusResponse, { state: "signed-in" }> = {
  accountEmail: "k@example.test",
  cloudUrl: "https://cloud.test",
  connected: false,
  cursor: 12,
  deviceId: "dev_1",
  dropped: 0,
  lastError: null,
  lastSyncedAt: null,
  pending: 3,
  state: "signed-in",
};

describe("the signed-in details", () => {
  it("says POLLING when no socket is up, rather than implying a live follow", () => {
    render(<SignedInDetails status={SIGNED_IN} nowMs={NOW_MS} />);
    expect(screen.getByText(/Polling/u)).toBeDefined();
    expect(screen.getByText(/3 queued/u)).toBeDefined();
    expect(screen.getByText(/synced never/u)).toBeDefined();
  });

  it("dates the last sync from the clock it is handed, never its own", () => {
    render(
      <SignedInDetails status={{ ...SIGNED_IN, lastSyncedAt: NOW_MS - 40_000 }} nowMs={NOW_MS} />,
    );
    expect(screen.getByText(/synced 40s ago/u)).toBeDefined();
  });

  it("counts the events that never reached the cloud, and says nothing while there are none", () => {
    const { rerender } = render(<SignedInDetails status={SIGNED_IN} nowMs={NOW_MS} />);
    expect(screen.queryByText(/never reached the cloud/u)).toBeNull();

    rerender(<SignedInDetails status={{ ...SIGNED_IN, dropped: 2 }} nowMs={NOW_MS} />);
    expect(screen.getByText("2 events never reached the cloud")).toBeDefined();
  });
});

describe("a sign-out the cloud did not take", () => {
  it("sends the person to the account's devices page to remove this device", () => {
    render(<RevokeFailedNotice cloudUrl="https://cloud.test" />);
    expect(screen.getByText(/could not remove itself from your account/u)).toBeDefined();
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://cloud.test/app/devices");
  });
});
