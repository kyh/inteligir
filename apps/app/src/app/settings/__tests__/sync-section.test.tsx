// @vitest-environment jsdom

// The sync surface's own claims — the ones that are not the server's: it
// refuses a draft rather than composing a pair request the cloud would reject,
// and it says what a paired install is actually doing rather than implying a
// live connection it may not have.

import { cleanup, render, screen } from "@testing-library/react";
import { CLOUD_DEVICE_NAME_MAX_LENGTH } from "@repo/server-contract/cloud";
import { afterEach, describe, expect, it } from "vitest";
import { PairForm, PairedDetails, readPairDraft } from "../sync-section";

afterEach(cleanup);

describe("reading the pair draft", () => {
  it("refuses an empty code and an empty name, each with its own sentence", () => {
    expect(readPairDraft("  ", "Laptop")).toEqual({
      ok: false,
      problem: "Enter the code from your account's Devices page.",
    });
    expect(readPairDraft("ABCD-EFGH", "  ")).toEqual({
      ok: false,
      problem: "Name this device so you can recognise it on your account.",
    });
  });

  it("refuses a name past the cloud's own ceiling, before the round trip", () => {
    expect(readPairDraft("ABCD-EFGH", "x".repeat(CLOUD_DEVICE_NAME_MAX_LENGTH + 1)).ok).toBe(false);
    expect(readPairDraft("ABCD-EFGH", "x".repeat(CLOUD_DEVICE_NAME_MAX_LENGTH)).ok).toBe(true);
  });

  it("does not judge the code's shape — that answer is the cloud's", () => {
    // A mistyped code gets the cloud's own "that code isn't valid" rather than
    // a local guess at the same sentence, which would go stale the day the
    // alphabet moves.
    expect(readPairDraft("nonsense", "Laptop")).toEqual({
      ok: true,
      request: { code: "nonsense", deviceName: "Laptop" },
    });
  });
});

describe("the pair form", () => {
  it("keeps its button disabled until the draft is one the cloud can take", () => {
    render(<PairForm cloudUrl="https://cloud.test" onSubmit={() => undefined} pending={false} />);
    const button = screen.getByRole("button", { name: "Pair this device" });
    expect(button instanceof HTMLButtonElement && button.disabled).toBe(true);
  });
});

describe("the paired details", () => {
  it("says POLLING when no socket is up, rather than implying a live follow", () => {
    render(
      <PairedDetails
        status={{
          state: "paired",
          cloudUrl: "https://cloud.test",
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
