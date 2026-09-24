// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScrubField } from "../fine-tune-card";

afterEach(cleanup);

type OnChange = (value: number) => void;

describe("ScrubField", () => {
  it("steps by a fractional step instead of rounding back to where it was", () => {
    const onChange = vi.fn<OnChange>();
    render(
      <ScrubField label="Temperature" value={0.5} onChange={onChange} min={0} max={1} step={0.1} />,
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "Temperature" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(0.6);
  });

  it("commits what was typed once the field lets go, so a partial number is never clamped", () => {
    const onChange = vi.fn<OnChange>();
    render(<ScrubField label="Width" value={20} onChange={onChange} min={10} max={100} />);
    const input = screen.getByRole("textbox", { name: "Width value" });

    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.change(input, { target: { value: "50" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveProperty("value", "50");

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it("clamps a typed value on Enter", () => {
    const onChange = vi.fn<OnChange>();
    render(<ScrubField label="Width" value={20} onChange={onChange} min={10} max={100} />);
    const input = screen.getByRole("textbox", { name: "Width value" });

    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
