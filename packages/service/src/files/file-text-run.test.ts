import { db } from "@repo/db/drizzle-client";
import { job } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { drainJobs } from "../jobs/drain-jobs";
import { JOB_RUNS } from "../jobs/job-kinds";
import { mintLibraryId } from "../library/library-ids";
import { readItemWhole } from "../library/library-rows";
import { personalLibrary } from "../test-support/library.fixture";
import { keepFile } from "./keep-file";
import { transcriptParagraphs } from "./image-text";
import { pdfParagraphs } from "./pdf-text";

const pageOf = (lines: readonly string[]) =>
  lines.map((line, at) => `BT /F1 12 Tf 20 ${String(700 - at * 40)} Td (${line}) Tj ET`).join("\n");

const pdfOf = (pages: readonly (readonly string[])[]) => {
  const kids = pages.map((_, at) => `${String(3 + at * 2)} 0 R`).join(" ");
  const font = 3 + pages.length * 2;

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${kids}]/Count ${String(pages.length)}>>`,
    ...pages.flatMap((lines, at) => {
      const stream = pageOf(lines);

      return [
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${String(4 + at * 2)} 0 R/Resources<</Font<</F1 ${String(font)} 0 R>>>>>>`,
        `<</Length ${String(stream.length)}>>stream\n${stream}\nendstream`,
      ];
    }),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];

  let text = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [at, body] of objects.entries()) {
    offsets.push(text.length);
    text += `${String(at + 1)} 0 obj${body}endobj\n`;
  }

  const xref = text.length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  text += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${entries.join("")}`;
  text += `trailer<</Size ${String(objects.length + 1)}/Root 1 0 R>>\nstartxref\n${String(xref)}\n%%EOF`;

  return new TextEncoder().encode(text);
};

const PAPER = pdfOf([["Herons wade the marsh at dawn"], ["Tidal flats feed the colony"]]);

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0,
]);

const savedFile = async (bytes: Uint8Array, mime: string, name: string) => {
  const { accountId, library } = await personalLibrary();
  const kept = await keepFile({ accountId, actor: { kind: "fill" } }, bytes, mime);

  if (!kept.ok) {
    throw new Error("the PDF was not kept");
  }

  const savedAt = Date.now();
  const id = mintLibraryId(savedAt);
  await library.items.createFile({
    id,
    name,
    parentId: null,
    savedAt,
    sha: kept.value,
    tags: [],
  });

  return { accountId, id, library };
};

const savedPdf = async (bytes: Uint8Array) =>
  await savedFile(bytes, "application/pdf", "field-notes.pdf");

const drained = async (accountId: string) =>
  await drainJobs({ accountId, budgetMs: 10_000, runs: JOB_RUNS });

describe("a picture's transcript", () => {
  it("keeps each paragraph on one line, and none for a picture with no words", () => {
    expect(transcriptParagraphs("Quarterly plan\n\nShip the\nexport  by Friday\n")).toStrictEqual([
      "Quarterly plan",
      "Ship the export by Friday",
    ]);
    expect(transcriptParagraphs(" NO TEXT\n")).toStrictEqual([]);
  });
});

dbSuite("a PDF's text", () => {
  it("reads each page's words as paragraphs", async () => {
    await expect(pdfParagraphs(PAPER)).resolves.toStrictEqual([
      "Herons wade the marsh at dawn",
      "Tidal flats feed the colony",
    ]);
  });

  it("leaves the bytes it reads as they were", async () => {
    const bytes = Uint8Array.from(PAPER);
    await pdfParagraphs(bytes);
    expect(bytes).toStrictEqual(PAPER);
  });

  it("reads nothing from bytes that aren't a PDF", async () => {
    await expect(
      pdfParagraphs(new TextEncoder().encode("%PDF-1.7\nnot one")),
    ).resolves.toStrictEqual([]);
  });

  it("lands an added PDF's words as its article, so search finds words inside it", async () => {
    const { accountId, id, library } = await savedPdf(PAPER);
    await expect(drained(accountId)).resolves.toMatchObject({ failed: 0, ran: 1 });

    const whole = await readItemWhole(db, accountId, id);
    expect(whole?.blocks.filter(({ section }) => section === "article")).toMatchObject([
      { block: { children: [{ text: "Herons wade the marsh at dawn" }], type: "p" } },
      { block: { children: [{ text: "Tidal flats feed the colony" }], type: "p" } },
    ]);
    await expect(library.search({ query: "tidal colony" })).resolves.toMatchObject({
      hits: [{ id, kind: "pdf" }],
    });
    await expect(
      db
        .select()
        .from(job)
        .where(and(eq(job.accountId, accountId), ne(job.kind, "meaning"))),
    ).resolves.toHaveLength(0);
  });

  it("leaves a PDF with no words as it was", async () => {
    const { accountId, id } = await savedPdf(pdfOf([[]]));
    const before = await readItemWhole(db, accountId, id);
    await expect(drained(accountId)).resolves.toMatchObject({ failed: 0, ran: 1 });
    await expect(readItemWhole(db, accountId, id)).resolves.toStrictEqual(before);
  });

  it("reads a PDF once, never over an article it already has", async () => {
    const { accountId, id, library } = await savedPdf(PAPER);
    await drained(accountId);
    const read = await readItemWhole(db, accountId, id);
    await library.items.organize({ ids: [id], pinned: true });
    await expect(drained(accountId)).resolves.toMatchObject({ ran: 0 });
    await expect(readItemWhole(db, accountId, id)).resolves.toMatchObject({
      bodyVersion: read?.bodyVersion,
    });
  });

  it("reads a PDF's text again on asking, over the article as it was edited", async () => {
    const { accountId, id, library } = await savedPdf(PAPER);
    await drained(accountId);
    const read = await readItemWhole(db, accountId, id);

    await library.items.saveBody({
      baseVersion: read?.bodyVersion ?? 0,
      blocks: [
        {
          block: { children: [{ text: "Herons wade the marsh" }], id: "edited", type: "p" },
          section: "article",
        },
      ],
      id,
    });

    await library.items.refresh({ id });
    await expect(drained(accountId)).resolves.toMatchObject({ failed: 0, ran: 1 });

    const again = await readItemWhole(db, accountId, id);
    expect(again?.blocks.filter(({ section }) => section === "article")).toMatchObject([
      { block: { children: [{ text: "Herons wade the marsh at dawn" }] } },
      { block: { children: [{ text: "Tidal flats feed the colony" }] } },
    ]);
  });

  it("reads no picture's words without a model to read them, and leaves it as it was", async () => {
    const { accountId, id } = await savedFile(PNG, "image/png", "screenshot.png");
    const before = await readItemWhole(db, accountId, id);

    expect(before?.item.fields.kind).toBe("image");
    await expect(drained(accountId)).resolves.toMatchObject({ failed: 0, ran: 1 });
    await expect(readItemWhole(db, accountId, id)).resolves.toStrictEqual(before);
  });
});
