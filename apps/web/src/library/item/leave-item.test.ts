import type { LeavingNote } from "@repo/editor/item/note-holds";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";
import { describe, expect, it, vi } from "vitest";

import { leaveItem } from "./leave-item";

const nothing = (): void => {
  // the note's status never moves in these cases
};

// an open note that stored every edit, or one holding an edit typed with no connection
const noteThat = (holds: boolean): LeavingNote => ({
  status: () => ({ edits: { kind: holds ? "live" : "offline" }, kind: "open", unsent: !holds }),
  subscribe: () => nothing,
  whenSaved: async () => await Promise.resolve(true),
});

const STAYS = vi.fn<() => Promise<boolean>>(async () => false);

describe("leaving the open item", () => {
  it("goes, asking nothing, once the note holds every edit, and with no item open", async () => {
    const ask = vi.fn<() => Promise<boolean>>();
    await expect(leaveItem(noteThat(true), ask)).resolves.toBe(true);
    await expect(leaveItem(null, ask)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks before giving up an edit the note lacks, and stays unless told to go", async () => {
    const note = noteThat(false);
    const ask = vi.fn<(options: ConfirmOptions) => Promise<boolean>>(async () => false);
    await expect(leaveItem(note, ask)).resolves.toBe(false);
    expect(ask.mock.calls[0]?.[0].title).toBe("Leave without saving?");
    ask.mockResolvedValue(true);
    await expect(leaveItem(note, ask)).resolves.toBe(true);
    await expect(leaveItem(note, STAYS)).resolves.toBe(false);
  });
});
