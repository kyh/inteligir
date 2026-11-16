import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { toast, Toaster } from "@repo/ui/components/sonner";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "#components/theme-provider";

import { fakePageLibrary, renderHookOnLibrary } from "../test-support/fake-page-library";
import type { CellCall } from "../test-support/fake-page-library";
import { useLibraryVerbs } from "./library-verbs";

afterEach(() => {
  vi.restoreAllMocks();
});

// a run of this many goes in two calls, the second of one
const TWO_CALLS = BULK_ITEMS_MAX + 1;

const addressOf = (at: number): string => `https://example.com/${String(at)}`;

// the verbs over the cell, under the toaster that draws what they say
const verbsOver = (
  cell: ReturnType<typeof createFakeCell>,
  answer?: (call: CellCall) => object | undefined,
) => {
  render(
    <ThemeProvider>
      <Toaster />
    </ThemeProvider>,
  );
  const { library } = fakePageLibrary({ answer, cell });
  return renderHookOnLibrary(useLibraryVerbs, library).result;
};

describe("a restore", () => {
  it("says what stayed in Deleted from every call it made", async () => {
    const cell = createFakeCell();
    const ids = Array.from({ length: TWO_CALLS }, (_, at) =>
      cell.seed.item({ deletedAt: 1, url: addressOf(at) }),
    );
    for (const at of [0, BULK_ITEMS_MAX]) {
      cell.seed.item({ url: addressOf(at) });
    }
    const verbs = verbsOver(cell);
    const restored = vi.spyOn(toast, "success");
    const held = vi.spyOn(toast, "info");

    await act(async () => {
      await verbs.current.restore(ids);
    });

    expect(restored.mock.lastCall?.[0]).toBe(`Restored ${String(TWO_CALLS - 2)} items.`);
    expect(held).toHaveBeenCalledWith(
      "2 items stayed in Deleted: another item holds the same address.",
    );
  });
});

describe("a delete", () => {
  it("that a refusal stops offers to undo what went, and only that", async () => {
    const cell = createFakeCell();
    const ids = Array.from({ length: TWO_CALLS }, () => cell.seed.item());
    let deletes = 0;
    const verbs = verbsOver(cell, (call) => {
      if (call.path === "library.items.delete") {
        deletes += 1;
        if (deletes === 2) {
          throw new Error("the cell is down");
        }
      }
    });
    const failed = vi.spyOn(toast, "error");

    await act(async () => {
      await verbs.current.remove(ids);
    });
    expect(failed.mock.lastCall?.[0]).toBe(
      `Stopped after ${String(BULK_ITEMS_MAX)} of ${String(TWO_CALLS)}. The library didn't answer.`,
    );
    const restores = vi.spyOn(toast, "success");
    fireEvent.click(
      await within(screen.getByRole("region", { name: /^Notifications/u })).findByRole("button", {
        name: "Undo",
      }),
    );

    await vi.waitFor(() => {
      expect(restores.mock.lastCall?.[0]).toBe(`Restored ${String(BULK_ITEMS_MAX)} items.`);
    });
    expect(
      [...cell.items().values()].filter((item) => item.fields.deletedAt !== null),
    ).toStrictEqual([]);
  });
});
