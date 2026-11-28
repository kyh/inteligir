import { shownFileSha } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { z } from "zod";

import type { WriteScope } from "./library-store";

export const fileTextJobSchema = z.strictObject({
  again: z.boolean().default(false),
  itemId: z.string().min(1).max(128),
  sha: z.string().regex(/^[0-9a-f]{64}$/u),
});

export type FileTextJob = z.infer<typeof fileTextJobSchema>;

type Read = Pick<LibraryItemFields, "deletedAt" | "editedSha" | "kind" | "originalSha">;

interface Landed {
  readonly id: string;
  readonly before: Read | null;
  readonly fields: Read;
}

export const readsText = (fields: Read) =>
  (fields.kind === "pdf" || fields.kind === "image") &&
  fields.deletedAt === null &&
  fields.originalSha !== null;

const asksText = ({ before, fields }: Landed) =>
  readsText(fields) &&
  (before === null || before.kind !== fields.kind || before.originalSha !== fields.originalSha);

const askOf = (payload: FileTextJob) => ({
  id: `file-text:${payload.itemId}`,
  kind: "file-text" as const,
  payload,
});

export const askFileTexts = async (scope: WriteScope, items: readonly Landed[]) => {
  const asks = items.flatMap((landed) => {
    const sha = shownFileSha(landed.fields);

    return !asksText(landed) || sha === null
      ? []
      : [askOf({ again: false, itemId: landed.id, sha })];
  });

  if (asks.length > 0) {
    await scope.askJobs(asks);
  }
};

export const askFileTextAgain = async (scope: WriteScope, itemId: string, sha: string) => {
  await scope.askJobs([askOf({ again: true, itemId, sha })]);
};
