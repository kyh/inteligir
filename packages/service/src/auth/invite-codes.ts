// The invite codes an account is made with, each spent once. The claim is the only atomic step:
// one UPDATE … WHERE redeemed_at IS NULL settles two simultaneous sign-ups on one code.

import { inviteCode } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { and, eq, isNull, sql } from "drizzle-orm";

const CODE_PATTERN = /^[A-Za-z0-9-]{6,64}$/u;

// false when the code will not work: malformed, unknown, or already claimed
export const claimInvite = async (code: string, email: string): Promise<boolean> => {
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

// scoped to the email this request claimed with, so a loser never releases a concurrent winner's
// claim
export const releaseInvite = async (code: string, email: string): Promise<void> => {
  await db
    .update(inviteCode)
    .set({ redeemedAt: null, redeemedBy: null })
    .where(and(eq(inviteCode.code, code), eq(inviteCode.redeemedBy, email)));
};

// redeemed_at stays set: clearing it would hand a working sign-up to whoever still holds the code.
// Case-insensitive because the gate stores the address as typed and Better Auth lowercases it.
export const forgetInviteRedeemer = async (email: string): Promise<void> => {
  await db
    .update(inviteCode)
    .set({ redeemedBy: null })
    .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`);
};
