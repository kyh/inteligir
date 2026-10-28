// An account's deletion, run by its library cell, one step after another and each one idempotent,
// so a deletion that fails part way runs again from the top and the account survives to retry
// (Better Auth's `beforeDelete`, `../auth/auth.ts`). First the tombstone, so every write, read and
// socket that races the rest is refused; then what the cell holds, the tombstone written back at
// once; then the account's files in R2; last its credentials in D1, which until then still verify
// only to meet the tombstone. The tombstone outlives the deletion, so a request that verified
// before the credentials went meets it too rather than founding a library nobody can reach. A
// later step joins the list where its order says.

import { createDb } from "../db/client";
import { forgetInviteRedeemer } from "../auth/invite";
import { purgeDeviceRows } from "../device/login";
import { accountBlobPrefix } from "./cell-blobs";
import { openCellSchema } from "./cell-schema";
import { closeEverySocket } from "./cell-sockets";
import { openCellLibrary } from "./cell-library";

export interface PurgeScope {
  readonly ctx: DurableObjectState;
  readonly env: Env;
  readonly accountId: string;
  readonly email: string;
}

export interface PurgeStep {
  readonly name: string;
  readonly run: (scope: PurgeScope) => Promise<void>;
}

// R2 deletes at most 1,000 keys a call, and a page lists at most as many
// (https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
const R2_PAGE = 1000;

// an empty schema and the time it was deleted, which every later call to the cell meets
const markDeleted = async (ctx: DurableObjectState, env: Env): Promise<void> => {
  await openCellSchema(ctx.storage);
  openCellLibrary(ctx, env).tombstone();
};

export const ACCOUNT_PURGE_STEPS: readonly PurgeStep[] = [
  {
    name: "tombstone",
    run: async ({ ctx, env }) => {
      await markDeleted(ctx, env);
      closeEverySocket(ctx);
    },
  },
  {
    name: "storage",
    run: async ({ ctx, env }) => {
      // the alarm goes with the rows (compatibility date 2026-02-24 and later). Storage calls
      // alone keep the cell's input gate shut, so no event lands between the wipe and the
      // tombstone, as one would across the R2 and D1 calls after it
      // (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
      await ctx.storage.deleteAll();
      await markDeleted(ctx, env);
    },
  },
  {
    name: "files",
    run: async ({ accountId, env }) => {
      const prefix = accountBlobPrefix(accountId);
      // listed from the start each time: what a page deleted is gone from the next listing
      let page: R2Objects;
      do {
        page = await env.BLOBS.list({ limit: R2_PAGE, prefix });
        if (page.objects.length > 0) {
          await env.BLOBS.delete(page.objects.map((object) => object.key));
        }
      } while (page.truncated);
    },
  },
  {
    name: "credentials",
    run: async ({ accountId, email, env }) => {
      const db = createDb(env.DB);
      await purgeDeviceRows(db, accountId);
      await forgetInviteRedeemer(db, email);
    },
  },
];

export const purgeAccount = async (
  scope: PurgeScope,
  steps: readonly PurgeStep[] = ACCOUNT_PURGE_STEPS,
): Promise<void> => {
  for (const step of steps) {
    await step.run(scope);
  }
};
