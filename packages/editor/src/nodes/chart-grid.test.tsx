import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChartGridEditor } from "@repo/editor/nodes/chart-grid";
import type { ChartPayload } from "@repo/editor/nodes/chart-node";

const CHART: ChartPayload = {
  data: [
    { label: "a", value: 1 },
    { label: "b", value: 2 },
    { label: "c", value: 3 },
  ],
  type: "bar",
};

const cell = (name: string): HTMLInputElement => {
  const input = screen.getByRole("textbox", { name });
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`${name} is not an input`);
  }
  return input;
};

const mountGrid = (chart: ChartPayload) => {
  const onCommit = vi.fn<(next: ChartPayload) => void>();
  const view = render(<ChartGridEditor chart={chart} onCommit={onCommit} onRawEdit={() => {}} />);
  const rerender = (next: ChartPayload): void => {
    view.rerender(<ChartGridEditor chart={next} onCommit={onCommit} onRawEdit={() => {}} />);
  };
  return { onCommit, rerender };
};

describe("the chart grid's cells", () => {
  it("keep focus on the next cell when the committed payload re-renders the grid", () => {
    const { onCommit, rerender } = mountGrid(CHART);
    const first = cell("Row 1 value 1");
    first.focus();
    fireEvent.change(first, { target: { value: "42" } });
    fireEvent.blur(first);
    const committed = onCommit.mock.calls[0]?.[0];
    expect(committed).toEqual({
      ...CHART,
      data: [{ label: "a", value: 42 }, ...CHART.data.slice(1)],
    });

    const next = cell("Row 2 value 1");
    next.focus();
    rerender(committed ?? CHART);

    expect(document.activeElement).toBe(next);
    expect(cell("Row 2 value 1")).toBe(next);
    expect(cell("Row 1 value 1").value).toBe("42");
  });

  it("shows the neighbour's value in a removed row's place", () => {
    const { rerender } = mountGrid(CHART);
    rerender({ ...CHART, data: CHART.data.filter((_, index) => index !== 1) });
    expect(cell("Row 2 label").value).toBe("c");
    expect(cell("Row 2 value 1").value).toBe("3");
  });

  it.each(["Infinity", "-Infinity", "1e999", "abc", " "])(
    "refuses %j, which JSON cannot carry as a number, and shows the old value",
    (typed) => {
      const { onCommit } = mountGrid(CHART);
      const input = cell("Row 1 value 1");
      fireEvent.change(input, { target: { value: typed } });
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(input.value).toBe("1");
    },
  );
});
