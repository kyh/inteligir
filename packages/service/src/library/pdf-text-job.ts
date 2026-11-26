import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { z } from "zod";

import type { WriteScope } from "./library-store";

export const pdfTextJobSchema = z.strictObject({
  again: z.boolean().default(false),
  itemId: z.string().min(1).max(128),
  sha: z.string().regex(/^[0-9a-f]{64}$/u),
});

export type PdfTextJob = z.infer<typeof pdfTextJobSchema>;

type Read = Pick<LibraryItemFields, "deletedAt" | "kind" | "originalSha">;

interface Landed {
  readonly id: string;
  readonly before: Read | null;
  readonly fields: Read;
}

const asksText = ({ before, fields }: Landed) =>
  fields.kind === "pdf" &&
  fields.deletedAt === null &&
  fields.originalSha !== null &&
  (before === null || before.kind !== "pdf" || before.originalSha !== fields.originalSha);

export const askPdfTexts = async (scope: WriteScope, items: readonly Landed[]) => {
  const asks = items.flatMap((landed) => {
    const sha = landed.fields.originalSha;

    if (!asksText(landed) || sha === null) {
      return [];
    }

    const payload: PdfTextJob = { again: false, itemId: landed.id, sha };

    return [{ id: `pdf-text:${landed.id}`, kind: "pdf-text" as const, payload }];
  });

  if (asks.length > 0) {
    await scope.askJobs(asks);
  }
};

export const askPdfTextAgain = async (scope: WriteScope, itemId: string, sha: string) => {
  const payload: PdfTextJob = { again: true, itemId, sha };

  await scope.askJobs([{ id: `pdf-text:${itemId}`, kind: "pdf-text", payload }]);
};
