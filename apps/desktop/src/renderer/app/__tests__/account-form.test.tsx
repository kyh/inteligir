// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CloudLoginRequest, CloudSignUpRequest } from "@repo/api/local/cloud/cloud-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountForm } from "../account-form";
import type { AccountFormProps } from "../account-form";

afterEach(cleanup);

const renderForm = (overrides: { pending?: boolean; refusal?: string | null } = {}) => {
  const onSignIn = vi.fn<(request: CloudLoginRequest) => void>();
  const onCreate = vi.fn<(request: CloudSignUpRequest) => void>();
  const props = (refusal: string | null): AccountFormProps => ({
    cloudUrl: "https://cloud.test",
    onCreate,
    onSignIn,
    pending: overrides.pending ?? false,
    refusal,
  });
  const { rerender } = render(<AccountForm {...props(overrides.refusal ?? null)} />);
  const refuse = (refusal: string): void => {
    rerender(<AccountForm {...props(refusal)} />);
  };
  return { onCreate, onSignIn, refuse };
};

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const button = (name: string): HTMLElement => screen.getByRole("button", { name });

const createMode = (): void => {
  fireEvent.click(button("Create an account"));
};

describe("the account form, signing in", () => {
  it("asks for an email and a password, the password unseen, and names the account's host", () => {
    renderForm();
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect(screen.getByText(/cloud\.test account/u)).toBeDefined();
    expect(screen.queryByLabelText("Invite code")).toBeNull();
  });

  it("submits nothing until both fields are filled, then hands both over as typed", () => {
    const { onSignIn } = renderForm();
    expect(button("Sign in").hasAttribute("disabled")).toBe(true);

    type("Email", "k@example.test");
    type("Password", " pw with spaces ");
    expect(button("Sign in").hasAttribute("disabled")).toBe(false);
    fireEvent.click(button("Sign in"));
    expect(onSignIn).toHaveBeenCalledWith({
      email: "k@example.test",
      password: " pw with spaces ",
    });
  });

  it("holds the button while a sign-in is in flight", () => {
    renderForm({ pending: true });
    type("Email", "k@example.test");
    type("Password", "correct horse battery");
    expect(button("Sign in").hasAttribute("disabled")).toBe(true);
  });

  it("shows the cloud's refusal beside the fields it applies to", () => {
    const { refuse } = renderForm();
    type("Email", "k@example.test");
    type("Password", "not the password");
    fireEvent.click(button("Sign in"));
    refuse("Wrong email or password.");
    expect(screen.getByText("Wrong email or password.")).toBeDefined();
  });

  it("sends a forgotten password to the cloud's own reset page", () => {
    renderForm();
    const link = screen.getByRole("link", { name: "Forgot password?" });
    expect(link.getAttribute("href")).toBe("https://cloud.test/app/forgot-password");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("the account form, creating an account", () => {
  it("asks for a name and an invite code beside the email and password", () => {
    renderForm();
    createMode();
    for (const label of ["Name", "Email", "Password", "Invite code"]) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
  });

  it("submits nothing until all four fields are filled", () => {
    const { onCreate } = renderForm();
    createMode();
    const submit = button("Create account");
    for (const [label, value] of [
      ["Name", "Kai"],
      ["Email", "k@example.test"],
      ["Password", "correct horse battery"],
    ] as const) {
      type(label, value);
      expect(submit.hasAttribute("disabled"), label).toBe(true);
    }
    type("Invite code", "INVITE-1");
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("hands every field over as typed, and keeps the email and password across modes", () => {
    const { onCreate, onSignIn } = renderForm();
    type("Email", "k@example.test");
    type("Password", " pw with spaces ");
    createMode();
    type("Name", " Kai ");
    type("Invite code", " INVITE-1 ");
    fireEvent.click(button("Create account"));
    expect(onCreate).toHaveBeenCalledWith({
      email: "k@example.test",
      inviteCode: " INVITE-1 ",
      name: " Kai ",
      password: " pw with spaces ",
    });
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("shows the refusal inline, and not under the sign-in fields it did not answer", () => {
    const { refuse } = renderForm();
    createMode();
    type("Name", "Kai");
    type("Email", "k@example.test");
    type("Password", "correct horse battery");
    type("Invite code", "USED-CODE");
    fireEvent.click(button("Create account"));
    refuse("That invite code isn't valid. Check it and try again.");
    expect(screen.getByText(/invite code isn't valid/u)).toBeDefined();
    expect(screen.getByDisplayValue("USED-CODE")).toBe(screen.getByLabelText("Invite code"));

    fireEvent.click(button("I have an account"));
    expect(screen.queryByText(/invite code isn't valid/u)).toBeNull();
  });

  it("opens on Create when asked, saying the surface's sentence in place of its own", () => {
    render(
      <AccountForm
        cloudUrl="https://cloud.test"
        onCreate={vi.fn<(request: CloudSignUpRequest) => void>()}
        onSignIn={vi.fn<(request: CloudLoginRequest) => void>()}
        pending={false}
        refusal={null}
        initialMode="create"
        lead="Dropbox already syncs these notes."
      />,
    );
    expect(screen.getByLabelText("Invite code")).toBeDefined();
    expect(screen.getByText("Dropbox already syncs these notes.")).toBeDefined();
    expect(screen.queryByText(/start syncing/u)).toBeNull();
    fireEvent.click(button("I have an account"));
    expect(screen.getByText("Dropbox already syncs these notes.")).toBeDefined();
  });
});
