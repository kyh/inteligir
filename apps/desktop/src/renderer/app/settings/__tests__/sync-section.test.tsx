// @vitest-environment jsdom

// The sync surface's own claims — the ones that are not the server's: it never
// asks a user to type anything to pair, it always leaves a link behind when the
// auto-open cannot be trusted, and it says what a paired install is actually
// doing rather than implying a live connection it may not have.

import { cleanup, render, screen } from "@testing-library/react";
import type { CloudPairBeginResponse } from "@repo/api/local/cloud/cloud-schema";
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
    // The auto-open is best-effort — a headless box, a machine with no
    // `xdg-open` — so the fallback sentence is a first-class outcome rather
    // than an error.
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
    // The whole point of issue #573: there is nowhere left to type a code.
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

describe("the paired details", () => {
  it("says POLLING when no socket is up, rather than implying a live follow", () => {
    render(
      <PairedDetails
        status={{
          state: "paired",
          cloudUrl: "https://cloud.test",
          accountEmail: "k@example.test",
          deviceId: "dev_1",
          connected: false,
          pending: 3,
          cursor: 12,
          lastSyncedAt: null,
          lastError: null,
        }}
      />,
    );
    expect(screen.getByText(/Polling/u)).toBeDefined();
    expect(screen.getByText(/3 queued/u)).toBeDefined();
    expect(screen.getByText(/synced never/u)).toBeDefined();
  });
});
