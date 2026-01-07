import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const DEFAULT = {
  PORT: "3000",
};

export const env = createEnv({
  client: {
    NEXT_PUBLIC_API_URL: z.string().default("http://localhost:4000"),
    NEXT_PUBLIC_ENVIRONMENT: z.string().default("development"),
    NEXT_PUBLIC_SITE_URL: z.string().optional(),
    NEXT_PUBLIC_STORAGE_PREFIX: z.string().default("/images"),
  },
  emptyStringAsUndefined: true,
  experimental__runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL && process.env.VERCEL_ENV !== "development"
        ? `https://${process.env.VERCEL_URL}`
        : `http://localhost:${process.env.PORT || DEFAULT.PORT}`),
    NEXT_PUBLIC_STORAGE_PREFIX: process.env.NEXT_PUBLIC_STORAGE_PREFIX,
    NODE_ENV: process.env.NODE_ENV,
  },
  server: {
    BETTER_AUTH_SECRET: z.string(),
    DATABASE_URL: z.string(),
    GITHUB_CLIENT_ID: z.string().default(""),
    GITHUB_CLIENT_SECRET: z.string().default(""),
    AI_GATEWAY_API_KEY: z.string().default(""),
    PORT: z.string().default(DEFAULT.PORT),
  },
  shared: {
    NEXT_PUBLIC_ENVIRONMENT: z.string().default("development"),
    NEXT_PUBLIC_SITE_URL: z.string().default(""),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
