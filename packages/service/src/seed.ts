import { inviteCode, user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { eq } from "drizzle-orm";

import { getSignUpAuth } from "./auth/auth";
import { mintSignInCode } from "./auth/sign-in-code";

const DEV_ACCOUNT = { email: "dev@inteligir.local", name: "Dev" };
const DEV_INVITE = "DEV-INVITE";

const seedAccount = async () => {
  const [held] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, DEV_ACCOUNT.email));

  if (held !== undefined) {
    return "already there";
  }

  await getSignUpAuth().api.signInEmailOTP({
    body: { ...DEV_ACCOUNT, otp: await mintSignInCode(DEV_ACCOUNT.email) },
  });

  return "made";
};

const seedInvite = async () => {
  const minted = await db
    .insert(inviteCode)
    .values({ code: DEV_INVITE })
    .onConflictDoNothing()
    .returning({ code: inviteCode.code });

  return minted.length > 0 ? "minted" : "already there";
};

try {
  console.log(`${DEV_ACCOUNT.email}: ${await seedAccount()}`);
  console.log(`invite ${DEV_INVITE}: ${await seedInvite()}`);
  console.log(`${DEV_ACCOUNT.email} signs in at /app/sign-in with a code from pnpm sign-in-code`);
} finally {
  await db.$client.end();
}
