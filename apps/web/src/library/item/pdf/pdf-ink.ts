import type { Color } from "./text-edits";

const BLACK: Color = { blue: 0, green: 0, red: 0 };
const WHITE: Color = { blue: 1, green: 1, red: 1 };
const STEP = 16;

const at = (pixels: Uint8ClampedArray, index: number) => ({
  blue: pixels[index + 2] ?? 0,
  green: pixels[index + 1] ?? 0,
  red: pixels[index] ?? 0,
});

const distance = (left: Color, right: Color) =>
  Math.abs(left.red - right.red) +
  Math.abs(left.green - right.green) +
  Math.abs(left.blue - right.blue);

const unit = ({ blue, green, red }: Color) => ({
  blue: blue / 255,
  green: green / 255,
  red: red / 255,
});

export const inkOf = (pixels: Uint8ClampedArray) => {
  const counts = new Map<string, { color: Color; count: number }>();

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const color = at(pixels, index);

    const key = [color.red, color.green, color.blue]
      .map((part) => Math.floor(part / STEP))
      .join(",");

    const held = counts.get(key);
    counts.set(key, { color: held?.color ?? color, count: (held?.count ?? 0) + 1 });
  }

  const [common] = [...counts.values()].toSorted((left, right) => right.count - left.count);

  if (common === undefined) {
    return { background: WHITE, color: BLACK };
  }

  let ink = common.color;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const color = at(pixels, index);

    if (distance(color, common.color) > distance(ink, common.color)) {
      ink = color;
    }
  }

  const contrast = common.color.red > 127 ? BLACK : WHITE;

  return {
    background: unit(common.color),
    color: distance(ink, common.color) < STEP * 3 ? contrast : unit(ink),
  };
};

export const cssColor = ({ blue, green, red }: Color) =>
  `rgb(${[red, green, blue].map((part) => String(Math.round(part * 255))).join(" ")})`;
