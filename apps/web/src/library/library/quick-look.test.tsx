// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listedItem } from "../test-support/cell-rows";
import { QuickLook } from "./quick-look";

afterEach(cleanup);

describe("a look at a card", () => {
  it("is called Untitled for an item with no title and no words", async () => {
    render(
      <QuickLook
        row={listedItem("0199a4c2-0000-7000-8000-0000000000a1")}
        onClose={vi.fn<() => void>()}
        onOpen={vi.fn<() => void>()}
        onStep={vi.fn<() => void>()}
      />,
    );

    await expect(screen.findByRole("dialog", { name: "Untitled" })).resolves.toBeDefined();
  });
});
