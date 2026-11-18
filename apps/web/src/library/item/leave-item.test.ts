import { HOLDS_ANSWER_MS } from "@repo/client/note-bodies";
import { deferred } from "@repo/contract/deferred";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";
import { afterEach, describe, expect, it, vi } from "vitest";

import { leaveItem, unloadAsks } from "./leave-item";

// an open note that holds every edit made here, or one that lacks an edit it couldn't save
const noteThat = (holds: boolean) => ({ holds: async () => await Promise.resolve(holds) });

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
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      cancelLabel: "Stay",
      confirmLabel: "Leave anyway",
      title: "Leave without saving?",
    });
    ask.mockResolvedValue(true);
    await expect(leaveItem(note, ask)).resolves.toBe(true);
    await expect(leaveItem(note, STAYS)).resolves.toBe(false);
  });

  describe("over a save that never answers", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("asks as for an edit the note couldn't save once the wait runs out, and not before", async () => {
      vi.useFakeTimers();
      const stalled = { holds: async () => await deferred<boolean>().promise };
      const ask = vi.fn<(options: ConfirmOptions) => Promise<boolean>>(async () => true);

      const leaving = leaveItem(stalled, ask);
      await vi.advanceTimersByTimeAsync(HOLDS_ANSWER_MS - 1);
      expect(ask).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      await expect(leaving).resolves.toBe(true);
      expect(ask.mock.calls[0]?.[0]).toMatchObject({ title: "Leave without saving?" });
    });
  });
});

const typing = (loses: boolean) => ({ unloadLoses: () => loses });

describe("the browser's ask as the tab closes or reloads", () => {
  it("is made only over typing a save sent as the page goes can't carry, and never once the session ended", () => {
    expect(unloadAsks(typing(true), { kind: "live" })).toBe(true);
    expect(unloadAsks(typing(false), { kind: "live" })).toBe(false);
    expect(unloadAsks(null, { kind: "live" })).toBe(false);
    expect(unloadAsks(typing(true), { kind: "ended", why: "signed-out" })).toBe(false);
    expect(unloadAsks(typing(true), { kind: "left" })).toBe(false);
  });
});
