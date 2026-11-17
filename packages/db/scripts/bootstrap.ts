// `pnpm bootstrap [port]`: brings this checkout's running `pnpm dev:web` to an account that signs
// in, and is safe to run again. The dev account's sign-in goes first because it is a query:
// miniflare makes D1's file on the Worker's first one, and only then has the push a file to reach.
// The account signs up through the invite gate as every account does, on an invite written
// straight to that file, since nothing mints one over HTTP. A dev account this file holds under
// another password is made again, since nobody can sign in to it by the one printed below. The
// Worker is named by its port alone, so the account's public password only ever reaches this
// machine.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { inviteCode, user } from "../src/d1/schema.ts";
import { localD1Url } from "./local-d1.ts";

const DEV_ACCOUNT = { email: "dev@inteligir.local", name: "Dev", password: "password" };

const port = process.argv[2] ?? "5174";
if (!/^\d+$/u.test(port)) {
  throw new Error(`\`pnpm bootstrap [port]\` takes the local Worker's port, not "${port}".`);
}
const origin = `http://localhost:${port}`;

const post = async (
  pathname: string,
  body: Readonly<Record<string, string>>,
): Promise<Response> => {
  try {
    return await fetch(`${origin}${pathname}`, {
      body: JSON.stringify(body),
      // node's fetch sends `sec-fetch-mode` as a browser does, and Better Auth refuses such a
      // request that names no origin
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });
  } catch (error) {
    throw new Error(`No Worker answers at ${origin}: start \`pnpm dev:web\` first.`, {
      cause: error,
    });
  }
};

const mintInvite = async (): Promise<string> => {
  const code = `DEV-${crypto.randomUUID()}`;
  const db = drizzle(localD1Url());
  await db.insert(inviteCode).values({ code });
  db.$client.close();
  return code;
};

// whether the file held the dev account, which then goes with its sessions: SQLite cascades only
// on a connection that asks it to
const forgetDevAccount = async (): Promise<boolean> => {
  const db = drizzle(localD1Url());
  await db.run(sql`PRAGMA foreign_keys = ON`);
  const gone = await db
    .delete(user)
    .where(eq(user.email, DEV_ACCOUNT.email))
    .returning({ id: user.id });
  db.$client.close();
  return gone.length > 0;
};

const { email, password } = DEV_ACCOUNT;
const signedIn = await post("/api/auth/sign-in/email", { email, password });
// a sign-in the Worker counted out says nothing about the account, which must not be remade on it
if (signedIn.status === 429) {
  throw new Error(`${origin} is counting sign-ins out: run \`pnpm bootstrap\` again in a minute.`);
}

execFileSync("drizzle-kit", ["push", "--config", "drizzle.config.local.ts", "--force"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  stdio: "inherit",
});

if (!signedIn.ok) {
  if (await forgetDevAccount()) {
    console.log(`${email} was held under another password: made again, its library empty.`);
  }
  const request: SignUpRequest = { ...DEV_ACCOUNT, inviteCode: await mintInvite() };
  const signedUp = await post(AUTH_API_PATHS.signUp, request);
  if (!signedUp.ok) {
    throw new Error(
      `${origin} refused the dev account's sign-up (${signedUp.status}): ${await signedUp.text()}`,
    );
  }
}

console.log(`${email} / ${password} signs in at ${origin}/app/sign-in`);
