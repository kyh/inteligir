import { viewsWith, viewsWithout } from "@repo/contract/library/saved-views";
import type { SavedView } from "@repo/contract/library/saved-views";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { libraryState } from "@repo/db/library-schema";
import { eq } from "drizzle-orm";

import { refuse } from "./library-refusal";
import type { WriteScope } from "./library-store";

export const savedViews = async (db: DbExecutor, accountId: string) => {
  const [row] = await db
    .select({
      head: libraryState.head,
      views: libraryState.views,
      viewsSeq: libraryState.viewsSeq,
    })
    .from(libraryState)
    .where(eq(libraryState.accountId, accountId));

  return row ?? { head: 0, views: [], viewsSeq: 0 };
};

const keepViews = async (scope: WriteScope, views: readonly SavedView[]) => {
  const seq = await scope.seq();

  await scope.tx
    .update(libraryState)
    .set({ views: [...views], viewsSeq: seq })
    .where(eq(libraryState.accountId, scope.accountId));

  return { seq };
};

export const saveView = async (scope: WriteScope, view: SavedView) => {
  const { views } = await savedViews(scope.tx, scope.accountId);

  return await keepViews(scope, viewsWith(views, view) ?? refuse({ kind: "too-large" }));
};

export const removeView = async (scope: WriteScope, id: string) => {
  const { head, views } = await savedViews(scope.tx, scope.accountId);

  if (!views.some((view) => view.id === id)) {
    return { seq: head };
  }

  return await keepViews(scope, viewsWithout(views, id));
};
