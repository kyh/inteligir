// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountDialog } from "../delete-account-dialog";
import type { DeleteAccountDialogProps } from "../delete-account-dialog";

afterEach(cleanup);

const renderDialog = (overrides: Partial<DeleteAccountDialogProps> = {}) => {
  const onDelete = vi.fn<(password: string) => void>();
  const props: DeleteAccountDialogProps = {
    onDelete,
    onOpenChange: () => {},
    open: true,
    pending: false,
    refusal: null,
    ...overrides,
  };
  const view = render(<DeleteAccountDialog {...props} />);
  const rerender = (next: Partial<DeleteAccountDialogProps>): void => {
    view.rerender(<DeleteAccountDialog {...props} {...next} />);
  };
  return { onDelete, rerender };
};

const deleteButton = async (): Promise<HTMLElement> =>
  await screen.findByRole("button", { name: "Delete account" });

const typePassword = (value: string): void => {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value } });
};

describe("the delete-account dialog", () => {
  it("names what goes and what stays on this Mac", async () => {
    renderDialog();
    expect(await screen.findByText("Delete your account?")).toBeDefined();
    expect(screen.getByText("The online copy of your notes")).toBeDefined();
    expect(screen.getByText("Your synced conversations with the agent")).toBeDefined();
    expect(screen.getByText(/Captures from your phone/u)).toBeDefined();
    expect(screen.getByText(/every device, this Mac included/u)).toBeDefined();
    expect(screen.getByText("Your notes on this Mac and their history stay here.")).toBeDefined();
  });

  it("deletes nothing until a password is typed, then hands it over as typed", async () => {
    const { onDelete } = renderDialog();
    const button = await deleteButton();
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");

    typePassword(" pw with spaces ");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalledWith(" pw with spaces ");
  });

  it("holds the button while the deletion runs", async () => {
    renderDialog({ pending: true });
    typePassword("correct horse battery");
    const button = await screen.findByRole("button", { name: "Deleting…" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("shows the cloud's refusal inside the dialog, keeping what was typed", async () => {
    const { rerender } = renderDialog();
    typePassword("not-the-password");
    rerender({ refusal: "Wrong password." });
    expect(await screen.findByText("Wrong password.")).toBeDefined();
    expect(screen.getByDisplayValue("not-the-password")).toBe(screen.getByLabelText("Password"));
  });

  it("forgets the typed password once it closes", async () => {
    const { rerender } = renderDialog();
    typePassword("correct horse battery");
    rerender({ open: false });
    rerender({ open: true });
    expect(await screen.findByLabelText("Password")).toHaveProperty("value", "");
  });
});
