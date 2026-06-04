/// <reference types="zod" />
import type { Db } from "@repo/db/drizzle-client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oAuthProxy } from "better-auth/plugins";

export type AuthConfig = {
  db: Db;
  baseURL: string;
  secret: string;
  productionURL?: string;
};

export function initAuth(config: AuthConfig) {
  return betterAuth({
    database: drizzleAdapter(config.db, {
      provider: "sqlite",
    }),
    baseURL: config.baseURL,
    secret: config.secret,
    plugins: [
      oAuthProxy({
        currentURL: config.baseURL,
        productionURL: config.productionURL ?? config.baseURL,
      }),
    ],
    emailAndPassword: {
      enabled: true,
    },
  });
}

export type Auth = ReturnType<typeof initAuth>;
