import type { Operand, Operation } from "./content-stream";
import type { FontMetrics } from "./pdf-fonts";

type Matrix = readonly [number, number, number, number, number, number];

export interface Box {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export interface Splice {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

interface GraphicsState {
  charSpacing: number;
  ctm: Matrix;
  font: FontMetrics | null;
  fontName: string | null;
  leading: number;
  rise: number;
  scale: number;
  size: number;
  wordSpacing: number;
}

type Piece =
  | { readonly kind: "adjust"; readonly value: number }
  | { readonly bytes: readonly number[]; readonly kind: "glyphs" };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const SPACE = 32;

const SHOWS = new Set(["Tj", "'", '"']);

const times = (left: Matrix, right: Matrix) =>
  [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
    left[4] * right[0] + left[5] * right[2] + right[4],
    left[4] * right[1] + left[5] * right[3] + right[5],
  ] satisfies Matrix;

const apply = (x: number, y: number, matrix: Matrix) => ({
  x: x * matrix[0] + y * matrix[2] + matrix[4],
  y: x * matrix[1] + y * matrix[3] + matrix[5],
});

const translation = (x: number, y: number) => [1, 0, 0, 1, x, y] satisfies Matrix;

const numbers = (operands: readonly Operand[]) =>
  operands.flatMap((operand) => (operand.kind === "number" ? [operand.value] : []));

const matrixOf = (operands: readonly Operand[]) => {
  const values = numbers(operands);

  if (values.length !== 6) {
    return null;
  }

  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;

  return [a, b, c, d, e, f] satisfies Matrix;
};

const formatted = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000;

  return Object.is(rounded, -0) ? "0" : String(rounded);
};

const hex = (bytes: readonly number[]) =>
  `<${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;

const inside = (point: { x: number; y: number }, box: Box) =>
  point.x >= box.left && point.x <= box.right && point.y >= box.bottom && point.y <= box.top;

const merged = (pieces: readonly Piece[]) => {
  const out: Piece[] = [];

  for (const piece of pieces) {
    const last = out.at(-1);

    if (last?.kind === "adjust" && piece.kind === "adjust") {
      out[out.length - 1] = { kind: "adjust", value: last.value + piece.value };
    } else if (piece.kind === "adjust" || piece.bytes.length > 0) {
      out.push(piece);
    }
  }

  return out;
};

const serialized = (pieces: readonly Piece[]) => {
  const parts = merged(pieces).flatMap((piece) => {
    if (piece.kind === "glyphs") {
      return [hex(piece.bytes)];
    }

    return Math.abs(piece.value) < 0.0005 ? [] : [formatted(piece.value)];
  });

  return `[${parts.join(" ")}] TJ`;
};

const leadOf = (operator: string, first: number, second: number) => {
  if (operator === "'") {
    return "T* ";
  }

  return operator === '"' ? `${formatted(first)} Tw ${formatted(second)} Tc T* ` : "";
};

const codesOf = (bytes: Uint8Array, step: 1 | 2) => {
  const codes: { code: number; bytes: number[] }[] = [];

  for (let index = 0; index + step <= bytes.length; index += step) {
    const high = bytes[index] ?? 0;
    const low = bytes[index + 1] ?? 0;
    codes.push({
      bytes: step === 2 ? [high, low] : [high],
      code: step === 2 ? high * 256 + low : high,
    });
  }

  return codes;
};

class TextWalker {
  readonly removed: number[];
  readonly fontNames: (string | null)[];
  readonly splices: Splice[] = [];
  private state: GraphicsState = {
    charSpacing: 0,
    ctm: IDENTITY,
    font: null,
    fontName: null,
    leading: 0,
    rise: 0,
    scale: 1,
    size: 0,
    wordSpacing: 0,
  };
  private readonly stack: GraphicsState[] = [];
  private textMatrix: Matrix = IDENTITY;
  private lineMatrix: Matrix = IDENTITY;
  private known = true;
  private readonly boxes: readonly Box[];
  private readonly fontOf: (name: string) => FontMetrics | null;

  constructor(boxes: readonly Box[], fontOf: (name: string) => FontMetrics | null) {
    this.boxes = boxes;
    this.fontOf = fontOf;
    this.removed = boxes.map(() => 0);
    this.fontNames = boxes.map(() => null);
  }

  walk(operation: Operation) {
    const { operator, operands } = operation;

    if (operator === "TJ") {
      this.showArray(operation);
    } else if (SHOWS.has(operator)) {
      this.showString(operation);
    } else if (!this.setText(operator, operands)) {
      this.setGraphics(operator, operands);
    }
  }

  private setGraphics(operator: string, operands: readonly Operand[]) {
    const matrix = operator === "cm" ? matrixOf(operands) : null;

    if (operator === "q") {
      this.stack.push({ ...this.state });
    } else if (operator === "Q") {
      this.state = this.stack.pop() ?? this.state;
    } else if (matrix !== null) {
      this.state.ctm = times(matrix, this.state.ctm);
    }
  }

  private setText(operator: string, operands: readonly Operand[]) {
    const [first = 0, second = 0] = numbers(operands);
    const { state } = this;

    const setters = new Map<string, () => void>([
      [
        "BT",
        () => {
          this.lineMatrix = IDENTITY;
          this.moveLine(0, 0);
        },
      ],
      [
        "TD",
        () => {
          state.leading = -second;
          this.moveLine(first, second);
        },
      ],
      [
        "TL",
        () => {
          state.leading = first;
        },
      ],
      [
        "Tc",
        () => {
          state.charSpacing = first;
        },
      ],
      [
        "Td",
        () => {
          this.moveLine(first, second);
        },
      ],
      [
        "Tf",
        () => {
          const [name] = operands;
          state.fontName = name?.kind === "name" ? name.value : null;
          state.font = state.fontName === null ? null : this.fontOf(state.fontName);
          state.size = numbers(operands).at(-1) ?? 0;
        },
      ],
      [
        "Tm",
        () => {
          const matrix = matrixOf(operands);

          if (matrix !== null) {
            this.lineMatrix = matrix;
            this.moveLine(0, 0);
          }
        },
      ],
      [
        "Ts",
        () => {
          state.rise = first;
        },
      ],
      [
        "Tw",
        () => {
          state.wordSpacing = first;
        },
      ],
      [
        "Tz",
        () => {
          state.scale = first / 100;
        },
      ],
      [
        "T*",
        () => {
          this.moveLine(0, -state.leading);
        },
      ],
    ]);

    const setter = setters.get(operator);

    setter?.();

    return setter !== undefined;
  }

  private moveLine(x: number, y: number) {
    this.lineMatrix = times(translation(x, y), this.lineMatrix);
    this.textMatrix = this.lineMatrix;
    this.known = true;
  }

  private showString({ end, operands, operator, start }: Operation) {
    const [first = 0, second = 0] = numbers(operands);

    if (operator === '"') {
      this.state.wordSpacing = first;
      this.state.charSpacing = second;
    }

    if (operator !== "Tj") {
      this.moveLine(0, -this.state.leading);
    }

    const shown = this.show(operands.filter(({ kind }) => kind === "string"));

    if (shown !== null) {
      this.splices.push({ end, start, text: `${leadOf(operator, first, second)}${shown}` });
    }
  }

  private showArray({ end, operands, start }: Operation) {
    const [array] = operands;
    const shown = array?.kind === "array" ? this.show(array.items) : null;

    if (shown !== null) {
      this.splices.push({ end, start, text: shown });
    }
  }

  private advanceBy(distance: number) {
    this.textMatrix = times(translation(distance, 0), this.textMatrix);
  }

  private show(items: readonly Operand[]) {
    const pieces: Piece[] = [];
    let changed = false;

    for (const item of items) {
      if (item.kind === "number") {
        pieces.push({ kind: "adjust", value: item.value });
        this.advanceBy((-item.value / 1000) * this.state.size * this.state.scale);
      } else if (item.kind === "string") {
        changed = this.showGlyphs(item.bytes, pieces) || changed;
      }
    }

    return changed ? serialized(pieces) : null;
  }

  private showGlyphs(bytes: Uint8Array, pieces: Piece[]) {
    const { font, size, scale, charSpacing, wordSpacing, rise, ctm } = this.state;
    let kept: number[] = [];
    let changed = false;

    for (const glyph of codesOf(bytes, font?.bytesPerCode ?? 1)) {
      const width = font?.width(glyph.code) ?? null;

      if (width === null) {
        this.known = false;
        kept.push(...glyph.bytes);
      } else {
        const spacing = glyph.bytes.length === 1 && glyph.code === SPACE ? wordSpacing : 0;
        const advance = ((width / 1000) * size + charSpacing + spacing) * scale;
        const middle = apply(advance / 2, rise, times(this.textMatrix, ctm));
        const hit = this.known ? this.boxes.findIndex((box) => inside(middle, box)) : -1;

        if (hit === -1) {
          kept.push(...glyph.bytes);
        } else {
          this.removed[hit] = (this.removed[hit] ?? 0) + 1;
          this.fontNames[hit] ??= this.state.fontName;
          changed = true;
          pieces.push({ bytes: kept, kind: "glyphs" });
          kept = [];
          const unit = size * scale;
          pieces.push({ kind: "adjust", value: unit === 0 ? 0 : (-advance * 1000) / unit });
        }

        this.advanceBy(advance);
      }
    }

    pieces.push({ bytes: kept, kind: "glyphs" });

    return changed;
  }
}

export const stripText = (
  operations: readonly Operation[],
  fontOf: (name: string) => FontMetrics | null,
  boxes: readonly Box[],
) => {
  const walker = new TextWalker(boxes, fontOf);

  for (const operation of operations) {
    walker.walk(operation);
  }

  return { fontNames: walker.fontNames, removed: walker.removed, splices: walker.splices };
};

export const spliced = (bytes: Uint8Array, splices: readonly Splice[]) => {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let at = 0;

  for (const splice of splices.toSorted((left, right) => left.start - right.start)) {
    parts.push(bytes.subarray(at, splice.start), encoder.encode(splice.text));
    at = splice.end;
  }

  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
};
