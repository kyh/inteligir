import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { getLiveEditor } from "@repo/editor/live-editor";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

describe("an action composed over a note with no id", () => {
  it("gives the note its id before the view context is read, so the revision names the file", async () => {
    const harness = await bootWorkspace({
      note: NOTE,
      seed: async (booted) => {
        await booted.client.vault.write({
          content: "# Plans\n\nFirst line.\n",
          guard: { kind: "overwrite" },
          path: NOTE,
        });
      },
    });
    await waitFor(() => {
      expect(getLiveEditor(NOTE)).not.toBeNull();
    });

    fireEvent.keyDown(window, chord("k"));
    fireEvent.change(await screen.findByLabelText("Ask the agent"), {
      target: { value: "Tidy the intro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(harness.driver.startedTurns).toHaveLength(1);
    });

    const { content } = await harness.client.vault.read({ path: NOTE });
    expect(frontmatterId(content)).not.toBeNull();
    expect(harness.driver.startedTurns[0]?.viewContext?.revision).toBe(
      await contentHashHex(content),
    );

    // the id the editor wrote is the one the thread holds: a move the rename route never saw
    // still finds the note
    await harness.vault.service.rename(NOTE, "Archive/Plans.md");
    const { threads } = await harness.client.threads.list({});
    expect(threads.map((thread) => thread.originDocPath)).toEqual(["Archive/Plans.md"]);
  });
});
