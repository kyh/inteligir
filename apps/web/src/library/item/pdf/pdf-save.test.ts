import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";

import { readOperations } from "./content-stream";
import type { Operand } from "./content-stream";
import { savedVersion } from "./pdf-save";
import type { FontChoice, TextEdit } from "./text-edits";
import type { FontFacts } from "./pdf-fonts";

const SIZE = 12;
const LEFT = 50;
const BASELINE = 700;
const WHITE = { blue: 1, green: 1, red: 1 };
const BLACK = { blue: 0, green: 0, red: 0 };

const SYSTEM_FONT = readFileSync(
  fileURLToPath(import.meta.resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf")),
);

const invoice = async (system = false) => {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);

  const font = system
    ? await document.embedFont(SYSTEM_FONT, { subset: true })
    : await document.embedFont(StandardFonts.Helvetica);

  const page = document.addPage([600, 800]);
  page.drawText("Total 100", { font, size: SIZE, x: LEFT, y: BASELINE });
  page.drawText("Keep this", { font, size: SIZE, x: LEFT, y: BASELINE - 40 });
  const start = LEFT + font.widthOfTextAtSize("Total ", SIZE);
  const end = LEFT + font.widthOfTextAtSize("Total 100", SIZE);

  return { bytes: await document.save(), end, start };
};

const textOf = (operands: readonly Operand[]) => {
  const waiting = [...operands].toReversed();
  let text = "";

  for (let operand = waiting.pop(); operand !== undefined; operand = waiting.pop()) {
    if (operand.kind === "string") {
      text += String.fromCodePoint(...operand.bytes);
    } else if (operand.kind === "array") {
      waiting.push(...[...operand.items].toReversed());
    }
  }

  return text;
};

const shownText = async (bytes: Uint8Array) => {
  const document = await PDFDocument.load(bytes);
  const [page] = document.getPages();
  const contents = page?.node.lookup(PDFName.of("Contents"));

  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index))
      : [contents];

  const operations = streams.flatMap((stream) =>
    stream instanceof PDFRawStream ? readOperations(decodePDFRawStream(stream).decode()) : [],
  );

  return {
    covered: operations.some(({ operator }) => operator === "re" || operator === "h"),
    text: operations
      .filter(({ operator }) => ["Tj", "TJ", "'", '"'].includes(operator))
      .map(({ operands }) => textOf(operands))
      .join("|"),
  };
};

const HELVETICA = async () =>
  await Promise.resolve({ kind: "standard", name: StandardFonts.Helvetica } satisfies FontChoice);

const editOf = (start: number, end: number) =>
  ({
    background: WHITE,
    box: { bottom: BASELINE - 3, left: start, right: end, top: BASELINE + 10 },
    color: BLACK,
    page: 0,
    size: SIZE,
    text: "250",
    x: start,
    y: BASELINE,
  }) satisfies TextEdit;

describe("an edited PDF's saved version", () => {
  it("takes the replaced words out of the file and writes the new ones in their place", async () => {
    const { bytes, end, start } = await invoice();
    const asked: (FontFacts | null)[] = [];

    const saved = await savedVersion(bytes, [editOf(start, end)], {
      fontFor: async (facts) => {
        asked.push(facts);

        return await HELVETICA();
      },
      strip: true,
    });

    const { covered, text } = await shownText(saved);

    expect(asked).toStrictEqual([
      { bold: false, fixed: false, italic: false, name: "Helvetica", serif: false },
    ]);
    expect(text).not.toContain("100");
    expect(text).toContain("Total ");
    expect(text).toContain("250");
    expect(text).toContain("Keep this");
    expect(covered).toBe(false);
  });

  it("takes out words a subset font wrote two bytes a letter, and writes in a system font", async () => {
    const { bytes, end, start } = await invoice(true);
    const asked: (FontFacts | null)[] = [];

    const saved = await savedVersion(bytes, [editOf(start, end)], {
      fontFor: async (facts) => {
        asked.push(facts);

        return await Promise.resolve({
          bytes: SYSTEM_FONT,
          key: "LiberationSans",
          kind: "system",
        } satisfies FontChoice);
      },
      strip: true,
    });

    const { covered } = await shownText(saved);

    expect(covered).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.name).toMatch(/^LiberationSans/u);
  });

  it("covers the old words when asked only to cover, leaving them in the file", async () => {
    const { bytes, end, start } = await invoice();

    const saved = await savedVersion(bytes, [editOf(start, end)], {
      fontFor: HELVETICA,
      strip: false,
    });

    const { covered, text } = await shownText(saved);

    expect(text).toContain("Total 100");
    expect(text).toContain("250");
    expect(covered).toBe(true);
  });
});

describe("a content stream's operations", () => {
  it("reads strings with escapes and nesting, hex, names, dictionaries and inline images", () => {
    const bytes = new TextEncoder().encode(
      String.raw`/Span <</MCID 3 /Alt (a) >> BDC (a\(b\) (c) \101\n) Tj <48 69> Tj BI /W 1 /H 1 ID x EI EMC [(A) -20 (B)] TJ`,
    );

    const operations = readOperations(bytes);

    expect(operations.map(({ operator }) => operator)).toStrictEqual([
      "BDC",
      "Tj",
      "Tj",
      "BI",
      "ID",
      "EI",
      "EMC",
      "TJ",
    ]);
    expect(textOf(operations[1]?.operands ?? [])).toBe("a(b) (c) A\n");
    expect(textOf(operations[2]?.operands ?? [])).toBe("Hi");
    expect(textOf(operations[7]?.operands ?? [])).toBe("AB");
  });
});
