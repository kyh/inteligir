import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

import { readOperations } from "./content-stream";
import { fontFacts, fontMetrics } from "./pdf-fonts";
import type { FontFacts } from "./pdf-fonts";
import { spliced, stripText } from "./pdf-strip";
import type { Box } from "./pdf-strip";
import { UnwritableTextError } from "./text-edits";
import type { Color, FontChoice, TextEdit } from "./text-edits";

const streamsOf = (page: PDFPage) => {
  const contents = page.node.Contents();

  if (contents instanceof PDFRawStream) {
    return [contents];
  }

  if (!(contents instanceof PDFArray)) {
    return null;
  }

  const streams: PDFRawStream[] = [];

  for (let index = 0; index < contents.size(); index += 1) {
    const stream = contents.lookup(index);

    if (!(stream instanceof PDFRawStream)) {
      return null;
    }

    streams.push(stream);
  }

  return streams;
};

const joined = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length + 1, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    out[offset + part.length] = 10;
    offset += part.length + 1;
  }

  return out;
};

const fontsOf = (page: PDFPage) => {
  const resources = page.node.Resources();
  const fonts = resources?.lookup(PDFName.of("Font"));

  return (name: string) => {
    const font = fonts instanceof PDFDict ? fonts.lookup(PDFName.of(name)) : undefined;

    return font instanceof PDFDict ? font : null;
  };
};

const rewritePage = (
  document: PDFDocument,
  page: PDFPage,
  boxes: readonly Box[],
  strip: boolean,
) => {
  const streams = streamsOf(page);
  const fontDict = fontsOf(page);

  if (streams === null) {
    return { facts: boxes.map(() => null), removed: boxes.map(() => 0) };
  }

  const content = joined(streams.map((stream) => decodePDFRawStream(stream).decode()));

  const walked = stripText(
    readOperations(content),
    (name) => {
      const font = fontDict(name);

      return font === null ? null : fontMetrics(font);
    },
    boxes,
  );

  const facts = walked.fontNames.map((name) => {
    const font = name === null ? null : fontDict(name);

    return font === null ? null : fontFacts(font);
  });

  const encoder = new TextEncoder();

  const wrapped = joined([
    encoder.encode("q"),
    strip ? spliced(content, walked.splices) : content,
    encoder.encode("Q"),
  ]);

  page.node.set(
    PDFName.of("Contents"),
    document.context.register(document.context.flateStream(wrapped)),
  );

  return { facts, removed: strip ? walked.removed : boxes.map(() => 0) };
};

const colorOf = ({ blue, green, red }: Color) => rgb(red, green, blue);

interface Saving {
  readonly fontFor: (facts: FontFacts | null) => Promise<FontChoice>;
  readonly strip: boolean;
}

const writeEdit = (page: PDFPage, edit: TextEdit, font: PDFFont, covers: boolean) => {
  if (covers) {
    page.drawRectangle({
      color: colorOf(edit.background),
      height: edit.box.top - edit.box.bottom,
      width: edit.box.right - edit.box.left,
      x: edit.box.left,
      y: edit.box.bottom,
    });
  }

  if (edit.text.length === 0) {
    return;
  }

  try {
    page.drawText(edit.text, {
      color: colorOf(edit.color),
      font,
      size: edit.size,
      x: edit.x,
      y: edit.y,
    });
  } catch {
    throw new UnwritableTextError(edit.text);
  }
};

export const savedVersion = async (
  bytes: Uint8Array,
  edits: readonly TextEdit[],
  { fontFor, strip }: Saving,
) => {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  document.registerFontkit(fontkit);
  const embedded = new Map<string, PDFFont>();

  const embed = async (facts: FontFacts | null) => {
    const choice = await fontFor(facts);
    const key = choice.kind === "standard" ? choice.name : choice.key;
    const held = embedded.get(key);

    if (held !== undefined) {
      return held;
    }

    const font =
      choice.kind === "standard"
        ? await document.embedFont(choice.name)
        : await document.embedFont(choice.bytes, { subset: true });

    embedded.set(key, font);

    return font;
  };

  for (const [index, page] of document.getPages().entries()) {
    const onPage = edits.filter((edit) => edit.page === index);

    if (onPage.length > 0) {
      const { facts, removed } = rewritePage(
        document,
        page,
        onPage.map(({ box }) => box),
        strip,
      );

      for (const [at, edit] of onPage.entries()) {
        writeEdit(page, edit, await embed(facts[at] ?? null), (removed[at] ?? 0) === 0);
      }
    }
  }

  return await document.save();
};
