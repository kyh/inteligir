// better-auth's return type leaks an internal `$strip` symbol from Zod's
// type declarations; the TS-emitted .d.ts for getAuth() can only name it
// when `zod` is reachable as a type-only import from this module. The
// runtime code below uses TypeBox; zod is a vendor-type carrier only.
import type {} from "zod";

import { getDb } from "@repo/db/drizzle-client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { oAuthProxy } from "better-auth/plugins";

const baseUrl =
  process.env["VERCEL_ENV"] === "production"
    ? `https://${process.env["VERCEL_PROJECT_PRODUCTION_URL"]}`
    : process.env["VERCEL_ENV"] === "preview"
      ? `https://${process.env["VERCEL_URL"]}`
      : "http://localhost:3000";

function buildAuth() {
  const authSecret = process.env["BETTER_AUTH_SECRET"] ?? process.env["AUTH_SECRET"];
  if (!authSecret) {
    throw new Error("BETTER_AUTH_SECRET (or AUTH_SECRET) is not set");
  }
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "pg",
    }),
    baseURL: baseUrl,
    secret: authSecret,
    plugins: [
      oAuthProxy({
        currentURL: baseUrl,
        productionURL: `https://${process.env["VERCEL_PROJECT_PRODUCTION_URL"] ?? "init.kyh.io"}`,
      }),
      nextCookies(),
    ],
    emailAndPassword: {
      enabled: true,
    },
  });
}

let cached: ReturnType<typeof buildAuth> | null = null;

/**
 * Lazy better-auth init. Initializing at module load makes `next build` fail
 * when BETTER_AUTH_SECRET isn't in the build env (Next 16 evaluates route
 * handlers to collect page data). Callers reach for auth only inside request
 * handlers, where the env is set.
 */
export function getAuth(): ReturnType<typeof buildAuth> {
  if (!cached) cached = buildAuth();
  return cached;
}
