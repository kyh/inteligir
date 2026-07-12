import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialogHost, confirm } from "@repo/ui/components/confirm-dialog";

vi.mock("@repo/ui/components/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) => (
    <div data-testid="dialog" data-open={String(open)}>
      {children}
    </div>
  ),
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));

afterEach(cleanup);

describe("ConfirmDialogHost", () => {
  it("keeps the settled options mounted while the dialog closes", async () => {
    const result = confirm({
      title: "Remove note?",
      body: "This cannot be undone.",
      cancelLabel: "Keep note",
      confirmLabel: "Remove note",
      destructive: true,
    });
    render(<ConfirmDialogHost />);

    expect(screen.getByTestId("dialog").dataset.open).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Keep note" }));

    expect(screen.getByTestId("dialog").dataset.open).toBe("false");
    expect(screen.getByRole("heading", { name: "Remove note?" })).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove note" })).toBeTruthy();
    await expect(result).resolves.toBe(false);
  });
});
