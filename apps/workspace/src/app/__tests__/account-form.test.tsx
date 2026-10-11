// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  CloudLoginRequest,
  CloudSignUpRequest,
} from "@repo/contract/local/cloud/cloud-schema";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountForm } from "../account-form";
import type { AccountFormProps } from "../account-form";

afterEach(cleanup);

const NO_REMOTE: VaultStatusResponse = {
  conflicts: [],
  device: "Kai's MacBook",
  externalSync: null,
  lastError: null,
  lastSyncAt: null,
  state: "no-remote",
};

const IN_DROPBOX: VaultStatusResponse = { ...NO_REMOTE, externalSync: { kind: "dropbox" } };

const renderForm = (
  overrides: Partial<Pick<AccountFormProps, "initialMode" | "vault">> & { pending?: boolean } = {},
) => {
  const signIn = vi.fn<(request: CloudLoginRequest) => void>();
  const signUp = vi.fn<(request: CloudSignUpRequest) => void>();
  const props = (refusal: string | null): AccountFormProps => ({
    cloudUrl: "https://cloud.test",
    session: { pending: overrides.pending ?? false, refusal, signIn, signUp },
    initialMode: overrides.initialMode ?? "sign-in",
    vault: "vault" in overrides ? overrides.vault : NO_REMOTE,
  });
  const { rerender } = render(<AccountForm {...props(null)} />);
  const refuse = (refusal: string): void => {
    rerender(<AccountForm {...props(refusal)} />);
  };
  return { onCreate: signUp, onSignIn: signIn, refuse };
};

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const button = (name: string): HTMLElement => screen.getByRole("button", { name });

const createMode = (): void => {
  fireEvent.click(button("Create an account"));
};

describe("the account form, signing in", () => {
  it("asks for an email and a password, the password unseen, and says what an account does", () => {
    renderForm();
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect(
      screen.getByText(
        "An account backs up your notes and brings them to your other Macs and your iPhone.",
      ),
    ).toBeDefined();
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

  it("opens on Create when asked, saying what an account does for notes another service syncs", () => {
    renderForm({ initialMode: "create", vault: IN_DROPBOX });
    const lead = /^Dropbox already syncs these notes/u;
    expect(screen.getByLabelText("Invite code")).toBeDefined();
    expect(screen.getByText(lead)).toBeDefined();
    fireEvent.click(button("I have an account"));
    expect(screen.getByText(lead)).toBeDefined();
  });

  it("says nothing of what an account does until the vault's status is known", () => {
    renderForm({ vault: undefined });
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.queryByText(/notes/u)).toBeNull();
  });
});
