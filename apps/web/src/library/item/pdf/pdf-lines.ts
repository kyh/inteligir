import { z } from "zod";

import type { Box } from "./pdf-strip";

export interface PdfLine {
  readonly box: Box;
  readonly fontName: string;
  readonly size: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

const pieceSchema = z.object({
  fontName: z.string(),
  hasEOL: z.boolean(),
  str: z.string(),
  transform: z
    .tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
    .transform(([a, b, c, d, e, f]) => ({ a, b, c, d, e, f })),
  width: z.number(),
});

type Piece = z.infer<typeof pieceSchema>;

interface Open {
  ascent: number;
  descent: number;
  fontName: string;
  left: number;
  right: number;
  size: number;
  text: string;
  y: number;
}

const ASCENT = 0.8;
const DESCENT = -0.2;
const LEVEL = 0.2;
const GAP = 1.5;
const SPACED = 0.15;

const upright = ({ transform: { a, b, c, d } }: Piece) =>
  a > 0 && d > 0 && Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3;

interface StyleMetrics {
  readonly ascent: number;
  readonly descent: number;
}

type Styles = Readonly<Partial<Record<string, StyleMetrics>>>;

const metricsOf = (styles: Styles, fontName: string) => {
  const style = styles[fontName];
  const ascent = style !== undefined && style.ascent > 0 ? style.ascent : ASCENT;
  const descent = style !== undefined && style.descent < 0 ? style.descent : DESCENT;

  return { ascent, descent };
};

const closed = (open: Open) => {
  const text = open.text.trim();

  return text === ""
    ? []
    : [
        {
          box: {
            bottom: open.y + open.descent * open.size,
            left: open.left,
            right: open.right,
            top: open.y + open.ascent * open.size,
          },
          fontName: open.fontName,
          size: open.size,
          text,
          x: open.left,
          y: open.y,
        } satisfies PdfLine,
      ];
};

const continues = (open: Open, piece: Piece) => {
  const { d: size, e: x, f: y } = piece.transform;

  return (
    Math.abs(y - open.y) < open.size * LEVEL &&
    Math.abs(size - open.size) < 0.5 &&
    x > open.right - open.size * 0.5 &&
    x < open.right + open.size * GAP
  );
};

const joinedText = (open: Open, piece: Piece) => {
  const { e: x } = piece.transform;
  const apart = x - open.right > open.size * SPACED;
  const bare = !/\s$/u.test(open.text) && !/^\s/u.test(piece.str);

  return apart && bare ? `${open.text} ${piece.str}` : `${open.text}${piece.str}`;
};

export const linesOf = (items: readonly unknown[], styles: Styles) => {
  const lines: PdfLine[] = [];
  let open: Open | null = null;

  for (const item of items) {
    const parsed = pieceSchema.safeParse(item);
    const piece = parsed.success && upright(parsed.data) ? parsed.data : null;

    if (piece !== null) {
      const { d: size, e: x, f: y } = piece.transform;

      if (open !== null && continues(open, piece)) {
        open.text = joinedText(open, piece);
        open.right = Math.max(open.right, x + piece.width);
      } else {
        lines.push(...(open === null ? [] : closed(open)));
        open = {
          ...metricsOf(styles, piece.fontName),
          fontName: piece.fontName,
          left: x,
          right: x + piece.width,
          size,
          text: piece.str,
          y,
        };
      }

      if (piece.hasEOL) {
        lines.push(...closed(open));
        open = null;
      }
    }
  }

  lines.push(...(open === null ? [] : closed(open)));

  return lines;
};
