// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

afterEach(cleanup);

describe("a dialog", () => {
  it("closes on the first Escape when its first focus is its close button", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Plans</DialogTitle>
          <DialogDescription>Nothing here takes the focus first.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    await waitFor(() => {
      expect(document.activeElement).toBe(close);
    });
    fireEvent.keyDown(close, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
