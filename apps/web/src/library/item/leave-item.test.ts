import type { ItemSessionStatus } from "@repo/editor/item/item-session";
import { noteFields } from "@repo/contract/test-support/library-items";
import { describe, expect, it, vi } from "vitest";

import { leaveItem } from "./leave-item";

const open = (unsaved: boolean, failure: string | null): ItemSessionStatus => ({
  failure,
  fields: noteFields(),
  kind: "open",
  unsaved,
});

const sessionAt = (status: ItemSessionStatus) => ({
  flush: vi.fn<() => Promise<void>>(async () => {}),
  status: () => status,
});

describe("leaving the open item", () => {
  it("writes the item and goes, asking nothing, once its edit is saved", async () => {
    const session = sessionAt(open(false, null));
    const ask = vi.fn<() => Promise<boolean>>();
    await expect(leaveItem(session, ask)).resolves.toBe(true);
    expect(session.flush).toHaveBeenCalledOnce();
    expect(ask).not.toHaveBeenCalled();
  });

  it("goes with no item open", async () => {
    const ask = vi.fn<() => Promise<boolean>>();
    await expect(leaveItem(null, ask)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("says why an edit that will not write is unsaved, and stays unless told to give it up", async () => {
    const session = sessionAt(open(true, "Part of this item can't be saved."));
    const ask = vi.fn<(options: { body?: unknown }) => Promise<boolean>>(async () => false);
    await expect(leaveItem(session, ask)).resolves.toBe(false);
    expect(ask.mock.calls[0]?.[0].body).toBe("Part of this item can't be saved.");
    ask.mockResolvedValue(true);
    await expect(leaveItem(session, ask)).resolves.toBe(true);
  });

  it("asks nothing of an edit typed while the write ran, which its own pause writes", async () => {
    const ask = vi.fn<() => Promise<boolean>>();
    await expect(leaveItem(sessionAt(open(true, null)), ask)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});
