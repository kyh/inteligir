import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

/* oxlint-disable anti-slop/no-runtime-typeof -- feature detection over a host object: jsdom has no
   pointer capture, and the switch takes it on a press. */
beforeAll(() => {
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = () => {};
  }
});
/* oxlint-enable anti-slop/no-runtime-typeof */

const mountSwitch = () => {
  const onCheckedChange = vi.fn<(checked: boolean) => void>();
  render(<Switch label="Pinned" checked={false} onCheckedChange={onCheckedChange} />);
  return {
    // the switch's own change carries Base UI's event details after the value
    chosen: () => onCheckedChange.mock.calls.map(([checked]) => checked),
    control: screen.getByRole("switch", { name: "Pinned" }),
  };
};

// a browser's press: the click follows the release, on the element that held the pointer
const press = (control: HTMLElement, from: number, to: number): void => {
  fireEvent.pointerDown(control, { clientX: from, pointerId: 1 });
  fireEvent.pointerMove(control, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(control, { clientX: to, pointerId: 1 });
  fireEvent.click(control);
};

describe("the switch", () => {
  it("toggles once for a press, wherever on it the press lands", () => {
    const { chosen, control } = mountSwitch();
    press(control, 0, 0);
    fireEvent.click(screen.getByText("Pinned"));
    expect(chosen()).toStrictEqual([true, true]);
  });

  it("chooses once for a drag past the middle, and the click that ends it is no second toggle", () => {
    const { chosen, control } = mountSwitch();
    press(control, 0, 20);
    expect(chosen()).toStrictEqual([true]);
  });

  it("chooses nothing for a drag let go on the side it began", () => {
    const { chosen, control } = mountSwitch();
    press(control, 0, 3);
    expect(chosen()).toStrictEqual([]);
  });
});
