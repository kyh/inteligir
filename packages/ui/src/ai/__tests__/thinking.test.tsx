// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThinkingStep } from "../thinking";

afterEach(cleanup);

describe("ThinkingRow", () => {
  it("activates through onSelect alone", () => {
    const onSelect = vi.fn<() => void>();
    render(<ThinkingStep onSelect={onSelect}>Read file</ThinkingStep>);
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
