import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fontkit from "@pdf-lib/fontkit";
import { StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { matchFace, standardFor, systemFontChooser } from "./system-fonts";

const fontFile = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(import.meta.resolve(`pdfjs-dist/standard_fonts/${name}.ttf`))),
  );

const REGULAR = fontFile("LiberationSans-Regular");
const BOLD = fontFile("LiberationSans-Bold");

const collectionOf = (fonts: readonly Uint8Array[]) => {
  const header = 12 + fonts.length * 4;
  const size = fonts.reduce((total, font) => total + font.length, header);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x74_74_63_66);
  view.setUint32(4, 0x00_01_00_00);
  view.setUint32(8, fonts.length);
  let base = header;

  for (const [index, font] of fonts.entries()) {
    out.set(font, base);
    view.setUint32(12 + index * 4, base);
    const tables = view.getUint16(base + 4);

    for (let table = 0; table < tables; table += 1) {
      const at = base + 12 + table * 16 + 8;
      view.setUint32(at, view.getUint32(at) + base);
    }

    base += font.length;
  }

  return out;
};

const face = (postscriptName: string, family: string, style: string, bytes: Uint8Array) => ({
  blob: async () => await Promise.resolve(new Blob([Uint8Array.from(bytes)])),
  family,
  fullName: `${family} ${style}`,
  postscriptName,
  style,
});

const FACTS = { bold: false, fixed: false, italic: false, name: "Calibri", serif: false };

describe("a system font for an edited PDF's words", () => {
  it("names a standard font of the same kind when the computer has none to give", async () => {
    expect(standardFor(null).name).toBe(StandardFonts.Helvetica);
    expect(standardFor({ ...FACTS, bold: true, serif: true }).name).toBe(
      StandardFonts.TimesRomanBold,
    );
    expect(standardFor({ ...FACTS, fixed: true, italic: true }).name).toBe(
      StandardFonts.CourierOblique,
    );
    await expect(
      systemFontChooser(async () => await Promise.resolve([])).choose(FACTS),
    ).resolves.toStrictEqual({
      kind: "standard",
      name: StandardFonts.Helvetica,
    });
  });

  it("matches the PDF's font by its name, then by its family and style", () => {
    const faces = [
      face("Arial-BoldMT", "Arial", "Bold", REGULAR),
      face("ArialMT", "Arial", "Regular", REGULAR),
      face("Georgia", "Georgia", "Regular", REGULAR),
    ];

    expect(matchFace(faces, { ...FACTS, name: "Georgia" })?.postscriptName).toBe("Georgia");
    expect(matchFace(faces, { ...FACTS, bold: true, name: "Arial,Bold" })?.postscriptName).toBe(
      "Arial-BoldMT",
    );
    expect(matchFace(faces, { ...FACTS, name: "ArialMT" })?.postscriptName).toBe("ArialMT");
    expect(matchFace(faces, FACTS)).toBeNull();
  });

  it("takes the one face it needs out of a font collection", async () => {
    const collection = collectionOf([REGULAR, BOLD]);

    const chooser = systemFontChooser(
      async () =>
        await Promise.resolve([
          face("LiberationSans", "Liberation Sans", "Regular", collection),
          face("LiberationSans-Bold", "Liberation Sans", "Bold", collection),
        ]),
    );

    const chosen = await chooser.choose({
      ...FACTS,
      bold: true,
      name: "LiberationSans-Bold",
    });

    if (chosen.kind !== "system") {
      throw new Error("no system font was chosen");
    }

    expect(fontkit.create(chosen.bytes).postscriptName).toBe("LiberationSans-Bold");
  });
});
