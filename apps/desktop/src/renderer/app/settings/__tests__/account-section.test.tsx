// @vitest-environment jsdom

import type { CloudDevice } from "@repo/api/local/cloud/cloud-schema";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountDevices, RevokeFailedNotice, SignedOutByAccount } from "../account-section";
import type { AccountDevicesProps, DeviceListState } from "../account-section";

afterEach(cleanup);

const NOW_MS = 1_756_600_000_000;
const MINUTE_MS = 60_000;

const THIS_MAC: CloudDevice = {
  createdAt: NOW_MS - 90 * MINUTE_MS,
  current: true,
  id: "dev_mac",
  lastSeenAt: NOW_MS,
  name: "Kai's MacBook",
};

const PHONE: CloudDevice = {
  createdAt: NOW_MS - 60 * MINUTE_MS,
  current: false,
  id: "dev_phone",
  lastSeenAt: NOW_MS - 3 * 60 * MINUTE_MS,
  name: "Kai's iPhone",
};

const renderDevices = (devices: DeviceListState, props: Partial<AccountDevicesProps> = {}) =>
  render(
    <>
      <dl>
        <AccountDevices
          thisMacName="Kai's MacBook"
          lastSyncedAt={NOW_MS - 2 * MINUTE_MS}
          nowMs={NOW_MS}
          devices={devices}
          revokingId={null}
          onRevoke={() => {}}
          onRetry={() => {}}
          {...props}
        />
      </dl>
      <ConfirmDialogHost />
    </>,
  );

const rowOf = (label: string): HTMLElement => {
  const term = screen.getByText(label);
  const row = term.parentElement;
  if (row === null) {
    throw new Error(`no row around ${label}`);
  }
  return row;
};

describe("Settings › Account's devices", () => {
  it("names this Mac on its own row and never offers to revoke it", () => {
    renderDevices({ devices: [THIS_MAC, PHONE], kind: "loaded" });

    const thisMac = within(rowOf("This Mac"));
    expect(thisMac.getByText("Kai's MacBook")).toBeDefined();
    expect(thisMac.getByText("Synced 2m ago")).toBeDefined();
    const others = within(rowOf("Other devices"));
    expect(others.queryByText("Kai's MacBook")).toBeNull();
    expect(others.getByText("Kai's iPhone")).toBeDefined();
    expect(others.getByText("Last seen 3h ago")).toBeDefined();
    expect(
      screen
        .getAllByRole("button", { name: /^Revoke/u })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Revoke Kai's iPhone"]);
  });

  it("says so when this Mac is the account's only device", () => {
    renderDevices({ devices: [THIS_MAC], kind: "loaded" });
    expect(within(rowOf("Other devices")).getByText("None")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Revoke/u })).toBeNull();
  });

  it("revokes nothing until the confirm is answered", async () => {
    const onRevoke = vi.fn<(deviceId: string) => void>();
    renderDevices({ devices: [THIS_MAC, PHONE], kind: "loaded" }, { onRevoke });

    fireEvent.click(screen.getByRole("button", { name: "Revoke Kai's iPhone" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Revoke Kai's iPhone?");
    expect(onRevoke).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(onRevoke).toHaveBeenCalledWith("dev_phone");
    });
  });

  it("revokes nothing when the confirm is cancelled", async () => {
    const onRevoke = vi.fn<(deviceId: string) => void>();
    renderDevices({ devices: [THIS_MAC, PHONE], kind: "loaded" }, { onRevoke });

    fireEvent.click(screen.getByRole("button", { name: "Revoke Kai's iPhone" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(onRevoke).not.toHaveBeenCalled();
  });

  it("says a list it could not load couldn't reach the account, and offers to try again", () => {
    const onRetry = vi.fn<() => void>();
    renderDevices({ kind: "failed", retrying: false }, { onRetry });

    expect(screen.getByText("Couldn't reach your account to list its devices.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    // this Mac's own row needs no answer from the account
    expect(within(rowOf("This Mac")).getByText("Kai's MacBook")).toBeDefined();
  });

  it("says a Mac that has not synced yet has not", () => {
    renderDevices({ kind: "loading" }, { lastSyncedAt: null });
    expect(screen.getByText("Not synced yet")).toBeDefined();
  });
});

describe("a Mac the account signed out", () => {
  it("says so plainly and offers one way back", () => {
    const onSignInAgain = vi.fn<() => void>();
    render(<SignedOutByAccount onSignInAgain={onSignInAgain} />);

    expect(screen.getByText("This Mac was signed out of your account.")).toBeDefined();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Sign in again",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(onSignInAgain).toHaveBeenCalledOnce();
  });
});

describe("a sign-out the cloud did not take", () => {
  it("sends the person to another device's Settings › Account, or the account's page", () => {
    render(<RevokeFailedNotice cloudUrl="https://cloud.test" />);
    expect(screen.getByText(/could not remove itself from your account/u)).toBeDefined();
    expect(screen.getByText(/Settings › Account on another device/u)).toBeDefined();
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://cloud.test/app/devices");
  });
});
