const uint32 = (value: number) =>
  [
    Math.floor(value / 2 ** 24),
    Math.floor(value / 2 ** 16) % 256,
    Math.floor(value / 2 ** 8) % 256,
    value % 256,
  ] satisfies number[];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const letters = (text: string) => Array.from(text, (letter) => letter.codePointAt(0) ?? 0);

export const pngOf = (width: number, height: number) =>
  new Uint8Array([
    ...PNG_SIGNATURE,
    ...uint32(13),
    ...letters("IHDR"),
    ...uint32(width),
    ...uint32(height),
  ]) satisfies Uint8Array;

const box = (type: string, ...body: number[][]) => {
  const inner = body.flat();

  return [...uint32(8 + inner.length), ...letters(type), ...inner] satisfies number[];
};

export const heifOf = (
  brand: string,
  sizes: readonly (readonly [width: number, height: number])[],
  lead = 0,
) =>
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
  ]) satisfies Uint8Array;
