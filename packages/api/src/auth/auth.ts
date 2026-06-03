import { db } from "@repo/db/drizzle-client";
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
    database: drizzleAdapter(db, {
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

// Lazy auth — initializing better-auth at module load forces every consumer
// (route handlers, trpc context) to have the secret in env even at build
// time. Defer to first request.
let cached: ReturnType<typeof buildAuth> | null = null;

function getAuth(): ReturnType<typeof buildAuth> {
  if (!cached) cached = buildAuth();
  return cached;
}

export const auth = new Proxy({} as ReturnType<typeof buildAuth>, {
  get(_target, prop, receiver) {
    return Reflect.get(getAuth(), prop, receiver);
  },
});
