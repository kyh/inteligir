// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { TaskItemRow } from "../task-rows";
import { ThinkingStep } from "../thinking";

afterEach(cleanup);

describe("ThinkingRow", () => {
  it("activates through onSelect alone", () => {
    const onSelect = vi.fn();
    render(<ThinkingStep onSelect={onSelect}>Read file</ThinkingStep>);
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("refuses a consumer onClick, which would displace onSelect under a truthful aria-pressed", () => {
    expectTypeOf<ComponentProps<typeof ThinkingStep>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof TaskItemRow>>().not.toHaveProperty("onClick");
  });
});
