import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
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
    chosen: () => onCheckedChange.mock.calls.map(([checked]) => checked),
    control: screen.getByRole("switch", { name: "Pinned" }),
  };
};

const press = (control: HTMLElement, from: number, to: number) => {
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

const thumbX = (control: HTMLElement) => {
  const thumb = control.querySelector<HTMLElement>("[data-unchecked], [data-checked]");
  const moved = /translateX\((?<x>[\d.-]+)px\)/u.exec(thumb?.style.transform ?? "");

  return Number(moved?.groups?.x);
};

const thumbPath = async (control: HTMLElement, frames: number) => {
  const path: number[] = [];

  const watch = () => {
    path.push(thumbX(control));

    if (path.length < frames) {
      requestAnimationFrame(watch);
    }
  };

  requestAnimationFrame(watch);
  await waitFor(
    () => {
      expect(path).toHaveLength(frames);
    },
    { timeout: 5000 },
  );

  return path;
};

const OFF_X = 2;
const ON_X = 14;
const SETTLED_FRAMES = 60;

const Owner = ({ takes }: { takes: boolean }) => {
  const [checked, setChecked] = useState(false);

  return (
    <Switch
      label="Pinned"
      checked={checked}
      onCheckedChange={(next) => {
        requestAnimationFrame(() => {
          if (takes) {
            setChecked(next);
          }
        });
      }}
    />
  );
};

const dragAcross = async (takes: boolean) => {
  render(<Owner takes={takes} />);
  const control = screen.getByRole("switch", { name: "Pinned" });
  await thumbPath(control, 2);
  fireEvent.pointerDown(control, { clientX: 0, pointerId: 1 });
  fireEvent.pointerMove(control, { clientX: 20, pointerId: 1 });
  await thumbPath(control, 1);
  expect(thumbX(control)).toBeGreaterThan((OFF_X + ON_X) / 2);
  fireEvent.pointerUp(control, { clientX: 20, pointerId: 1 });
  fireEvent.click(control);

  return control;
};

describe("a flick right after a press", () => {
  it("chooses the side it is let go on, though the press's own resize still moves the thumb", async () => {
    const onCheckedChange = vi.fn<(checked: boolean) => void>();
    render(<Switch label="Pinned" checked onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole("switch", { name: "Pinned" });
    await thumbPath(control, 2);
    fireEvent.pointerDown(control, { clientX: 20, pointerId: 1 });
    await thumbPath(control, 2);
    fireEvent.pointerMove(control, { clientX: 0, pointerId: 1 });
    await thumbPath(control, 2);
    fireEvent.pointerUp(control, { clientX: 0, pointerId: 1 });
    fireEvent.click(control);
    expect(onCheckedChange.mock.calls.map(([checked]) => checked)).toStrictEqual([false]);
  });
});

describe("the thumb after a drag", () => {
  it("springs back to the off side when the owner keeps it off", async () => {
    const control = await dragAcross(false);
    const path = await thumbPath(control, SETTLED_FRAMES);
    expect(path.at(-1)).toBeCloseTo(OFF_X, 1);
  });

  it("goes on to the on side, never back first, when the owner takes it a frame later", async () => {
    const control = await dragAcross(true);
    const dropped = thumbX(control);
    const path = await thumbPath(control, SETTLED_FRAMES);
    expect(Math.min(...path)).toBeGreaterThanOrEqual(dropped);
    expect(path.at(-1)).toBeCloseTo(ON_X, 1);
  });
});
