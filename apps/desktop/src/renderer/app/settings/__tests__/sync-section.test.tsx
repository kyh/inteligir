// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "../../sign-in-form";
import { RevokeFailedNotice, SignedInDetails } from "../sync-section";

afterEach(cleanup);

const renderForm = (overrides: { pending?: boolean; refusal?: string | null } = {}) => {
  const onSignIn = vi.fn<(login: { email: string; password: string }) => void>();
  render(
    <SignInForm
      cloudUrl="https://cloud.test"
      onSignIn={onSignIn}
      pending={overrides.pending ?? false}
      refusal={overrides.refusal ?? null}
    />,
  );
  return { onSignIn };
};

const fill = (email: string, password: string): void => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
};

describe("the sign-in form", () => {
  it("asks for an email and a password, the password unseen, and names the account's host", () => {
    renderForm();
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect(screen.getByText(/cloud\.test account/u)).toBeDefined();
  });

  it("submits nothing until both fields are filled, then hands both over as typed", () => {
    const { onSignIn } = renderForm();
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button.hasAttribute("disabled")).toBe(true);

    fill("k@example.test", " pw with spaces ");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onSignIn).toHaveBeenCalledWith({
      email: "k@example.test",
      password: " pw with spaces ",
    });
  });

  it("holds the button while a sign-in is in flight", () => {
    renderForm({ pending: true });
    fill("k@example.test", "correct horse battery");
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the cloud's refusal beside the fields it applies to", () => {
    renderForm({ refusal: "Wrong email or password." });
    expect(screen.getByText("Wrong email or password.")).toBeDefined();
  });
});

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
