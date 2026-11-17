// `pnpm bootstrap [port]`: brings this checkout's running `pnpm dev:web` to an account that signs
// in, and is safe to run again. The dev account's sign-in goes first because it is a query:
// miniflare makes D1's file on the Worker's first one, and only then has the push a file to reach.
// The account signs up through the invite gate as every account does, on an invite written
// straight to that file, since nothing mints one over HTTP. The Worker is named by its port alone,
// so the account's public password only ever reaches this machine.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
import { drizzle } from "drizzle-orm/libsql";
import { inviteCode } from "../src/d1/schema.ts";
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

const { email, password } = DEV_ACCOUNT;
const signedIn = await post("/api/auth/sign-in/email", { email, password });

execFileSync("pnpm", ["run", "push"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  stdio: "inherit",
});

if (!signedIn.ok) {
  const request: SignUpRequest = { ...DEV_ACCOUNT, inviteCode: await mintInvite() };
  const signedUp = await post(AUTH_API_PATHS.signUp, request);
  if (!signedUp.ok) {
    throw new Error(
      `${origin} refused the dev account's sign-up (${signedUp.status}): ${await signedUp.text()}`,
    );
  }
}

console.log(`${email} / ${password} signs in at ${origin}/app/sign-in`);
