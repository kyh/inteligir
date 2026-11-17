// What an account's library may hold: `LIBRARY_STORAGE_CAP_BYTES`, 1 GiB unless set, of its files'
// bytes and its bodies' together, each a sum of the rows that hold them. Only a create past the
// cap is refused, so a person never loses a word mid-note and a full library can still be tidied.

import { file, itemBody } from "@repo/db/library-schema";
import { eq, sql } from "drizzle-orm";

import { env } from "../env";
import { refuse } from "./library-refusal";
import type { WriteScope } from "./library-store";

const bytesUsed = async ({ accountId, tx }: WriteScope): Promise<number> => {
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

// refuses `growth` more bytes once they would pass the cap
export const holdRoomFor = async (scope: WriteScope, growth: number): Promise<void> => {
  if (growth <= 0) {
    return;
  }
  const bytesCap = env.LIBRARY_STORAGE_CAP_BYTES;
  const used = await bytesUsed(scope);
  if (used + growth > bytesCap) {
    refuse({ bytesCap, bytesUsed: used, kind: "quota" });
  }
};
