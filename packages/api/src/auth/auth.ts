import { db } from "@repo/db/drizzle-client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { oAuthProxy } from "better-auth/plugins";

const baseUrl =
  process.env.VERCEL_ENV === "production"
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_ENV === "preview"
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

const authSecret = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
if (!authSecret) {
  throw new Error("BETTER_AUTH_SECRET (or AUTH_SECRET) is not set");
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  baseURL: baseUrl,
  secret: authSecret,
  plugins: [
    oAuthProxy({
      currentURL: baseUrl,
      productionURL: `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "init.kyh.io"}`,
    }),
    nextCookies(),
  ],
  emailAndPassword: {
    enabled: true,
  },
});
