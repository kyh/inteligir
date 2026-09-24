import { getLiveEditor } from "@repo/editor/live-editor";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootWorkspace, chord } from "./boot-workspace";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTE = "Plans.md";

const editable = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-slate-editor="true"]');
  if (element === null) {
    throw new Error("the note's editor is not on screen");
  }
  return element;
};

describe("the ⌘K composer", () => {
  it("hands focus back to the note's editor on Escape", async () => {
    await bootWorkspace({
      note: NOTE,
      seed: async (harness) => {
        await harness.client.vault.write({ content: "# Plans\n\nFirst line.\n", path: NOTE });
      },
    });
    await waitFor(() => {
      expect(getLiveEditor(NOTE)).not.toBeNull();
    });
    act(() => {
      getLiveEditor(NOTE)?.tf.focus();
    });
    expect(document.activeElement).toBe(editable());

    fireEvent.keyDown(window, chord("k"));
    const field = await screen.findByLabelText("Ask the agent");
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });

    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByLabelText("Ask the agent")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(editable());
    });
  });
});
