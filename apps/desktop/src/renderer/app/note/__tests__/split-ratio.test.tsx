// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSplitRatio } from "../split-ratio";

afterEach(cleanup);

const ROW_WIDTH = 1000;

function PaneRow() {
  const { ratio, paneRowRef, onDividerPointerDown } = useSplitRatio();
  return (
    <div ref={paneRowRef}>
      <div data-testid="divider" onPointerDown={onDividerPointerDown} />
      <output>{String(ratio)}</output>
    </div>
  );
}

/** A mounted row whose geometry jsdom will not compute for us. */
function paneRow() {
  const view = render(<PaneRow />);
  const row = view.container.firstElementChild;
  if (row !== null) {
    row.getBoundingClientRect = () => new DOMRect(0, 0, ROW_WIDTH, 500);
  }
  const scope = within(view.container);
  return {
    grab: (): void => {
      fireEvent.pointerDown(scope.getByTestId("divider"));
    },
    moveTo: (clientX: number): void => {
      fireEvent.pointerMove(window, { clientX });
    },
    release: (): void => {
      fireEvent.pointerUp(window);
    },
    ratio: (): string => scope.getByRole("status").textContent ?? "",
  };
}

describe("the split divider's drag", () => {
  it("gives the primary pane the share the pointer names", () => {
    const row = paneRow();
    row.grab();
    row.moveTo(300);
    row.release();
    expect(row.ratio()).toBe("0.3");
  });

  it("clamps at both ends, so neither pane can be dragged away", () => {
    const narrow = paneRow();
    narrow.grab();
    narrow.moveTo(10);
    narrow.release();
    expect(narrow.ratio()).toBe("0.25");

    const wide = paneRow();
    wide.grab();
    wide.moveTo(ROW_WIDTH - 10);
    wide.release();
    expect(wide.ratio()).toBe("0.75");
  });

  it("stops following the pointer once it is released", () => {
    const row = paneRow();
    row.grab();
    row.moveTo(300);
    row.release();
    row.moveTo(700);
    expect(row.ratio()).toBe("0.3");
  });
});
