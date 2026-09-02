// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type {
  CloudPairBeginResponse,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import { afterEach, describe, expect, it } from "vitest";
import { describeBegun, PairPrompt, PairedDetails } from "../sync-section";

afterEach(cleanup);

const BEGUN: CloudPairBeginResponse = {
  url: "https://cloud.test/app/pair?redirect=http%3A%2F%2F127.0.0.1%3A4664%2Fpair%2Fcallback&state=00112233445566778899aabbccddeeff&name=Laptop",
  opened: true,
  deviceName: "Laptop",
  expiresInMs: 600_000,
};

describe("what the section says once an approval is armed", () => {
  it("points at the window it opened", () => {
    expect(describeBegun(BEGUN)).toBe(
      "Approve “Laptop” in the browser window that just opened. The link works for 10 minutes.",
    );
  });

  it("points at the link instead when nothing opened", () => {
    expect(describeBegun({ ...BEGUN, opened: false })).toBe(
      "Open this link to approve “Laptop”. It works for 10 minutes.",
    );
  });
});

describe("the pair prompt", () => {
  it("offers one button and no field to type into", () => {
    render(
      <PairPrompt
        cloudUrl="https://cloud.test"
        begun={null}
        onBegin={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Pair with browser" })).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the URL as a link once an approval is armed", () => {
    render(
      <PairPrompt
        cloudUrl="https://cloud.test"
        begun={{ ...BEGUN, opened: false }}
        onBegin={() => undefined}
        pending={false}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(BEGUN.url);
  });
});

const NOW_MS = 1_756_600_000_000;

const PAIRED: Extract<CloudStatusResponse, { state: "paired" }> = {
  state: "paired",
  cloudUrl: "https://cloud.test",
  accountEmail: "k@example.test",
  deviceId: "dev_1",
  connected: false,
  pending: 3,
  cursor: 12,
  lastSyncedAt: null,
  lastError: null,
};

describe("the paired details", () => {
  it("says POLLING when no socket is up, rather than implying a live follow", () => {
    render(<PairedDetails status={PAIRED} nowMs={NOW_MS} />);
    expect(screen.getByText(/Polling/u)).toBeDefined();
    expect(screen.getByText(/3 queued/u)).toBeDefined();
    expect(screen.getByText(/synced never/u)).toBeDefined();
  });

  it("dates the last sync from the clock it is handed, never its own", () => {
    render(<PairedDetails status={{ ...PAIRED, lastSyncedAt: NOW_MS - 40_000 }} nowMs={NOW_MS} />);
    expect(screen.getByText(/synced 40s ago/u)).toBeDefined();
  });
});
