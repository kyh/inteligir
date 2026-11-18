import type { LibraryItemFields } from "@repo/contract/library/library-item";

import type { FillJob } from "../fill/fill-job";
import type { WriteScope } from "./library-store";

interface Landed {
  readonly id: string;
  readonly fields: Pick<LibraryItemFields, "deletedAt" | "reading" | "url">;
  readonly cover?: string | null;
}

export const askFills = async (scope: WriteScope, items: readonly Landed[]) => {
  await scope.askJobs(
    items.flatMap(({ cover = null, fields, id }) => {
      if (fields.reading.state !== "pending" || fields.url === null || fields.deletedAt !== null) {
        return [];
      }

      const payload: FillJob = { coverHint: cover, itemId: id, url: fields.url };

      return [{ id: `fill:${id}`, kind: "fill" as const, payload }];
    }),
  );
};
