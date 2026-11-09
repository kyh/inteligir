// @vitest-environment jsdom

import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickLook } from "./quick-look";

afterEach(cleanup);

describe("a look at a card", () => {
  it("is called Untitled for an item with no title and no words", async () => {
    const cell = createFakeCell();
    render(
      <QuickLook
        row={cell.listed(cell.seed.item())}
        onClose={vi.fn<() => void>()}
        onOpen={vi.fn<() => void>()}
        onStep={vi.fn<() => void>()}
      />,
    );

    await expect(screen.findByRole("dialog", { name: "Untitled" })).resolves.toBeDefined();
  });
});
