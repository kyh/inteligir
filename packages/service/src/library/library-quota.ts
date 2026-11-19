import type { DbExecutor } from "@repo/db/drizzle-client";
import { file, itemBody } from "@repo/db/library-schema";
import { eq, sql } from "drizzle-orm";

import { env } from "../env";
import { refuse } from "./library-refusal";
import type { LibraryRefusal } from "./library-refusal";
import type { WriteScope } from "./library-store";

const bytesUsed = async (tx: DbExecutor, accountId: string) => {
  const [files, bodies] = await Promise.all([
    tx
      .select({ bytes: sql`coalesce(sum(${file.bytes}), 0)`.mapWith(Number) })
      .from(file)
      .where(eq(file.accountId, accountId)),
    tx
      .select({ bytes: sql`coalesce(sum(${itemBody.bytes}), 0)`.mapWith(Number) })
      .from(itemBody)
      .where(eq(itemBody.accountId, accountId)),
  ]);

  return (files[0]?.bytes ?? 0) + (bodies[0]?.bytes ?? 0);
};

export const roomRefusalFor = async (tx: DbExecutor, accountId: string, growth: number) => {
  if (growth <= 0) {
    return null;
  }

  const bytesCap = env.LIBRARY_STORAGE_CAP_BYTES;
  const used = await bytesUsed(tx, accountId);

  return (
    used + growth > bytesCap ? { bytesCap, bytesUsed: used, kind: "quota" } : null
  ) satisfies Extract<LibraryRefusal, { kind: "quota" }> | null;
};

export const holdRoomFor = async ({ accountId, tx }: WriteScope, growth: number) => {
  const refusal = await roomRefusalFor(tx, accountId, growth);

  if (refusal !== null) {
    refuse(refusal);
  }
};
