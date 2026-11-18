import { inviteCode } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { and, eq, isNull, sql } from "drizzle-orm";

const CODE_PATTERN = /^[A-Za-z0-9-]{6,64}$/u;

export const claimInvite = async (code: string, email: string) => {
  if (!CODE_PATTERN.test(code)) {
    return false;
  }

  const claimed = await db
    .update(inviteCode)
    .set({ redeemedAt: new Date(), redeemedBy: email })
    .where(and(eq(inviteCode.code, code), isNull(inviteCode.redeemedAt)))
    .returning({ code: inviteCode.code });

  return claimed.length > 0;
};

export const releaseInvite = async (code: string, email: string) => {
  await db
    .update(inviteCode)
    .set({ redeemedAt: null, redeemedBy: null })
    .where(and(eq(inviteCode.code, code), eq(inviteCode.redeemedBy, email)));
};

export const forgetInviteRedeemer = async (email: string) => {
  await db
    .update(inviteCode)
    .set({ redeemedBy: null })
    .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`);
};
