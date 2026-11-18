import { inviteCode, user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { eq } from "drizzle-orm";

import { getSignUpAuth } from "./auth/auth";

const DEV_ACCOUNT = { email: "dev@inteligir.local", name: "Dev", password: "password" };
const DEV_INVITE = "DEV-INVITE";

const signsIn = async (userId: string) => {
  const auth = await getSignUpAuth().$context;
  const accounts = await auth.internalAdapter.findAccounts(userId);
  const credential = accounts.find((account) => account.providerId === "credential");

  if (credential?.password === undefined || credential.password === null) {
    return false;
  }

  return await auth.password.verify({ hash: credential.password, password: DEV_ACCOUNT.password });
};

const seedAccount = async () => {
  const [held] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, DEV_ACCOUNT.email));

  if (held !== undefined) {
    if (await signsIn(held.id)) {
      return "already signs in";
    }

    await db.delete(user).where(eq(user.id, held.id));
  }

  await getSignUpAuth().api.signUpEmail({ body: DEV_ACCOUNT });

  return held === undefined ? "made" : "was held under another password: made again";
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
  console.log(`${DEV_ACCOUNT.email} / ${DEV_ACCOUNT.password} signs in at /app/sign-in`);
} finally {
  await db.$client.end();
}
