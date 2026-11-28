import { describe, expect, it } from "vitest";

import { inkOf } from "./pdf-ink";
import { linesOf } from "./pdf-lines";

interface Extra {
  readonly hasEOL?: boolean;
  readonly transform?: readonly number[];
}

const piece = (str: string, x: number, y: number, width: number, extra: Extra = {}) => ({
  dir: "ltr",
  fontName: "g_d0_f1",
  hasEOL: false,
  height: 12,
  str,
  transform: [12, 0, 0, 12, x, y],
  width,
  ...extra,
});

describe("the lines of a PDF page a person can click", () => {
  it("joins the pieces of one baseline into a line, and breaks at a new one", () => {
    const lines = linesOf(
      [
        piece("Total", 72, 700, 30),
        piece("100", 108, 700, 18),
        { type: "beginMarkedContent" },
        piece("Next line", 72, 680, 50, { hasEOL: true }),
        piece("   ", 72, 660, 10),
      ],
      { g_d0_f1: { ascent: 0.9, descent: -0.25 } },
    );

    expect(lines).toStrictEqual([
      {
        box: { bottom: 697, left: 72, right: 126, top: 710.8 },
        fontName: "g_d0_f1",
        size: 12,
        text: "Total 100",
        x: 72,
        y: 700,
      },
      expect.objectContaining({ text: "Next line", y: 680 }),
    ]);
  });

  it("leaves turned text alone and keeps far-apart columns apart", () => {
    const lines = linesOf(
      [
        piece("Left", 72, 700, 24),
        piece("Right", 400, 700, 30),
        piece("Turned", 72, 600, 40, { transform: [0, 12, -12, 0, 72, 600] }),
      ],
      {},
    );

    expect(lines.map(({ text }) => text)).toStrictEqual(["Left", "Right"]);
    expect(lines[0]?.box.top).toBeCloseTo(709.6);
  });
});

const pixels = (colors: readonly (readonly [number, number, number])[]) =>
  new Uint8ClampedArray(colors.flatMap(([red, green, blue]) => [red, green, blue, 255]));

describe("the ink of a line", () => {
  it("takes the page's colour as the background and the strongest other as the text", () => {
    const white = [255, 255, 255] as const;

    expect(inkOf(pixels([white, white, white, [128, 0, 0], [200, 120, 120]]))).toStrictEqual({
      background: { blue: 1, green: 1, red: 1 },
      color: { blue: 0, green: 0, red: 128 / 255 },
    });
  });

  it("writes black on a blank light box and white on a blank dark one", () => {
    expect(inkOf(pixels([[250, 250, 250]])).color).toStrictEqual({ blue: 0, green: 0, red: 0 });
    expect(inkOf(pixels([[10, 10, 10]])).color).toStrictEqual({ blue: 1, green: 1, red: 1 });
  });
});
