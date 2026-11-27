import { Encodings, Font, FontNames } from "@pdf-lib/standard-fonts";
import { PDFArray, PDFDict, PDFName, PDFNumber } from "pdf-lib";

export interface FontMetrics {
  readonly bytesPerCode: 1 | 2;
  readonly width: (code: number) => number | null;
}

const STANDARD_NAMES: ReadonlyMap<string, FontNames> = new Map(
  Object.values(FontNames).map((name) => [name, name]),
);

const STANDARD_ALIASES: ReadonlyMap<string, FontNames> = new Map([
  ["Arial", FontNames.Helvetica],
  ["Arial,Bold", FontNames.HelveticaBold],
  ["Arial,Italic", FontNames.HelveticaOblique],
  ["Arial,BoldItalic", FontNames.HelveticaBoldOblique],
  ["CourierNew", FontNames.Courier],
  ["TimesNewRoman", FontNames.TimesRoman],
  ["TimesNewRoman,Bold", FontNames.TimesRomanBold],
  ["TimesNewRoman,Italic", FontNames.TimesRomanItalic],
]);

const WIN_ANSI_NAMES: ReadonlyMap<number, string> = new Map(
  Encodings.WinAnsi.supportedCodePoints.map((point) => {
    const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(point);

    return [code, name];
  }),
);

const numberAt = (array: PDFArray, index: number) => {
  const value = array.lookup(index);

  return value instanceof PDFNumber ? value.asNumber() : null;
};

const numberOf = (dict: PDFDict, key: string) => {
  const value = dict.lookup(PDFName.of(key));

  return value instanceof PDFNumber ? value.asNumber() : null;
};

const nameOf = (dict: PDFDict, key: string) => {
  const value = dict.lookup(PDFName.of(key));

  return value instanceof PDFName ? value.decodeText() : null;
};

const dictOf = (dict: PDFDict, key: string) => {
  const value = dict.lookup(PDFName.of(key));

  return value instanceof PDFDict ? value : null;
};

const arrayOf = (dict: PDFDict, key: string) => {
  const value = dict.lookup(PDFName.of(key));

  return value instanceof PDFArray ? value : null;
};

const differences = (font: PDFDict) => {
  const named = new Map<number, string>();
  const encoding = dictOf(font, "Encoding");
  const list = encoding === null ? null : arrayOf(encoding, "Differences");

  if (list === null) {
    return named;
  }

  let next = 0;

  for (let index = 0; index < list.size(); index += 1) {
    const entry = list.lookup(index);

    if (entry instanceof PDFNumber) {
      next = entry.asNumber();
    } else if (entry instanceof PDFName) {
      named.set(next, entry.decodeText());
      next += 1;
    }
  }

  return named;
};

const baseName = (font: PDFDict) => (nameOf(font, "BaseFont") ?? "").replace(/^[A-Z]{6}\+/u, "");

const standardOf = (font: PDFDict) => {
  const name = baseName(font);

  return STANDARD_NAMES.get(name) ?? STANDARD_ALIASES.get(name) ?? null;
};

const simpleMetrics = (font: PDFDict) => {
  const widths = arrayOf(font, "Widths");
  const first = numberOf(font, "FirstChar") ?? 0;
  const descriptor = dictOf(font, "FontDescriptor");
  const missing = descriptor === null ? null : numberOf(descriptor, "MissingWidth");

  if (widths !== null) {
    return {
      bytesPerCode: 1,
      width: (code) => {
        const index = code - first;

        return index >= 0 && index < widths.size() ? numberAt(widths, index) : missing;
      },
    } satisfies FontMetrics;
  }

  const standard = standardOf(font);

  if (standard === null) {
    return null;
  }

  const afm = Font.load(standard);
  const renamed = differences(font);

  return {
    bytesPerCode: 1,
    width: (code) => {
      const glyph = renamed.get(code) ?? WIN_ANSI_NAMES.get(code);

      return glyph === undefined ? null : (afm.getWidthOfGlyph(glyph) ?? null);
    },
  } satisfies FontMetrics;
};

const cidWidths = (descendant: PDFDict) => {
  const widths = new Map<number, number>();
  const list = arrayOf(descendant, "W");

  if (list === null) {
    return widths;
  }

  for (let index = 0; index < list.size();) {
    const first = numberAt(list, index);
    const next = list.lookup(index + 1);

    if (first === null) {
      return widths;
    }

    if (next instanceof PDFArray) {
      for (let offset = 0; offset < next.size(); offset += 1) {
        const width = numberAt(next, offset);

        if (width !== null) {
          widths.set(first + offset, width);
        }
      }

      index += 2;
    } else {
      const last = numberAt(list, index + 1);
      const width = numberAt(list, index + 2);

      if (last === null || width === null) {
        return widths;
      }

      for (let cid = first; cid <= last; cid += 1) {
        widths.set(cid, width);
      }

      index += 3;
    }
  }

  return widths;
};

const compositeMetrics = (font: PDFDict) => {
  const encoding = nameOf(font, "Encoding");
  const descendants = arrayOf(font, "DescendantFonts");
  const descendant = descendants?.lookup(0);

  if (
    (encoding !== "Identity-H" && encoding !== "Identity-V") ||
    !(descendant instanceof PDFDict)
  ) {
    return null;
  }

  const widths = cidWidths(descendant);
  const fallback = numberOf(descendant, "DW") ?? 1000;

  return {
    bytesPerCode: 2,
    width: (cid) => widths.get(cid) ?? fallback,
  } satisfies FontMetrics;
};

export const fontMetrics = (font: PDFDict) => {
  const subtype = nameOf(font, "Subtype");

  if (subtype === "Type0") {
    return compositeMetrics(font);
  }

  if (subtype === "Type1" || subtype === "TrueType" || subtype === "MMType1") {
    return simpleMetrics(font);
  }

  return null;
};

export interface FontFacts {
  readonly bold: boolean;
  readonly fixed: boolean;
  readonly italic: boolean;
  readonly name: string;
  readonly serif: boolean;
}

const FIXED_PITCH = 1;
const SERIF = 2;
const ITALIC = 64;
const FORCE_BOLD = 262_144;

const hasFlag = (flags: number, bit: number) => Math.floor(flags / bit) % 2 === 1;

const describedBy = (font: PDFDict) => {
  const descendant = arrayOf(font, "DescendantFonts")?.lookup(0);
  const owner = descendant instanceof PDFDict ? descendant : font;

  return dictOf(owner, "FontDescriptor");
};

export const fontFacts = (font: PDFDict) => {
  const name = baseName(font);
  const descriptor = describedBy(font);
  const flags = descriptor === null ? 0 : (numberOf(descriptor, "Flags") ?? 0);
  const weight = descriptor === null ? null : numberOf(descriptor, "FontWeight");
  const angle = descriptor === null ? 0 : (numberOf(descriptor, "ItalicAngle") ?? 0);

  return {
    bold:
      /bold|black|heavy|semibold|demi/iu.test(name) ||
      (weight ?? 400) >= 600 ||
      hasFlag(flags, FORCE_BOLD),
    fixed: hasFlag(flags, FIXED_PITCH) || /mono|courier|consol/iu.test(name),
    italic: /italic|oblique/iu.test(name) || angle !== 0 || hasFlag(flags, ITALIC),
    name,
    serif:
      hasFlag(flags, SERIF) ||
      (/times|serif|georgia|garamond|roman/iu.test(name) && !/sans/iu.test(name)),
  } satisfies FontFacts;
};
