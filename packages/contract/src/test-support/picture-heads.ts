// The head of a picture as the suites build one: the bytes its type and its size are read from.

const uint32 = (value: number): number[] => [
  Math.floor(value / 2 ** 24),
  Math.floor(value / 2 ** 16) % 256,
  Math.floor(value / 2 ** 8) % 256,
  value % 256,
];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const letters = (text: string): number[] =>
  Array.from(text, (letter) => letter.codePointAt(0) ?? 0);

// a PNG's signature and IHDR
export const pngOf = (width: number, height: number): Uint8Array =>
  new Uint8Array([
    ...PNG_SIGNATURE,
    ...uint32(13),
    ...letters("IHDR"),
    ...uint32(width),
    ...uint32(height),
  ]);

// an ISO media box: its length, its four letters, its body
const box = (type: string, ...body: number[][]): number[] => {
  const inner = body.flat();
  return [...uint32(8 + inner.length), ...letters(type), ...inner];
};

// a HEIF still under `brand` whose item properties name each of `sizes`, as a grid's tiles and its
// whole picture each have one, with `lead` bytes of free space ahead of its `meta` box
export const heifOf = (
  brand: string,
  sizes: readonly (readonly [width: number, height: number])[],
  lead = 0,
): Uint8Array =>
  new Uint8Array([
    ...box("ftyp", letters(brand), uint32(0)),
    ...(lead === 0
      ? []
      : box(
          "free",
          Array.from({ length: lead }, () => 0),
        )),
    ...box(
      "meta",
      uint32(0),
      box(
        "iprp",
        box(
          "ipco",
          ...sizes.map(([width, height]) => box("ispe", uint32(0), uint32(width), uint32(height))),
        ),
      ),
    ),
  ]);
