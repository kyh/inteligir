// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSplitRatio } from "../split-ratio";

afterEach(cleanup);

const ROW_WIDTH = 1000;

function PaneRow() {
  const { paneRowRef, dividerProps } = useSplitRatio();
  return (
    <div ref={paneRowRef}>
      <div data-testid="divider" {...dividerProps} />
    </div>
  );
}

/** A mounted row whose geometry jsdom will not compute for us. */
function paneRow() {
  const view = render(<PaneRow />);
  const row = view.container.firstElementChild;
  if (!(row instanceof HTMLElement)) throw new Error("the pane row did not mount");
  row.getBoundingClientRect = () => new DOMRect(0, 0, ROW_WIDTH, 500);
  const divider = within(row).getByTestId("divider");
  return {
    grab: (): void => {
      fireEvent.pointerDown(divider, { pointerId: 1 });
    },
    moveTo: (clientX: number): void => {
      fireEvent.pointerMove(divider, { pointerId: 1, clientX });
    },
    moveWindowTo: (clientX: number): void => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX });
    },
    release: (): void => {
      fireEvent.pointerUp(divider, { pointerId: 1 });
    },
    width: (): string => row.style.getPropertyValue("--split-primary"),
  };
}

describe("the split divider's drag", () => {
  it("gives the primary pane the share the pointer names", () => {
    const row = paneRow();
    row.grab();
    row.moveTo(300);
    row.release();
    expect(row.width()).toBe("30%");
  });

  it("clamps at both ends, so neither pane can be dragged away", () => {
    const narrow = paneRow();
    narrow.grab();
    narrow.moveTo(10);
    narrow.release();
    expect(narrow.width()).toBe("25%");

    const wide = paneRow();
    wide.grab();
    wide.moveTo(ROW_WIDTH - 10);
    wide.release();
    expect(wide.width()).toBe("75%");
  });

  it("stops following the pointer once it is released", () => {
    const row = paneRow();
    row.grab();
    row.moveTo(300);
    row.release();
    row.moveTo(700);
    expect(row.width()).toBe("30%");
  });

  it("listens on the divider alone, so no drag can outlive the node", () => {
    const row = paneRow();
    row.grab();
    row.moveWindowTo(700);
    // Nothing on the window: a pointer released outside it, or a divider
    // unmounted mid-drag, cannot leave a live handler resizing the workspace.
    expect(row.width()).toBe("");
  });
});
