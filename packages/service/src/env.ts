import { parseReleaseVersion } from "@repo/contract/client-build";
import { z } from "zod";

// Every key is optional or defaulted, so a missing one turns its feature off instead of crashing
// boot; `.env.example` documents each. Platform vars (`NODE_ENV`, `PORT`, `VERCEL_*`) aren't app
// configuration, so they stay raw at their read sites.

/** Blank reads as unset: it disables, never crashes. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === "" ? undefined : trimmed;
  });

/** Only the exact words: a typo fails boot rather than reading as off. */
const flag = z.stringbool({ case: "sensitive", falsy: ["false"], truthy: ["true"] }).default(false);

/** Anything after the host (a trailing slash, a path) is dropped, so URLs built on it come out right. */
const origin = optionalText.pipe(
  z
    .url({ protocol: /^https?$/u })
    .transform((url) => new URL(url).origin)
    .optional(),
);

const postgresUrl = optionalText.pipe(z.url({ protocol: /^postgres(?:ql)?$/u }).optional());

/** A release version: a floor between a beta and its release would need an order no floor is worth. */
const buildFloor = (fallback: string) =>
  optionalText.transform((text, context) => {
    const spelled = text ?? fallback;
    const version = parseReleaseVersion(spelled);
    if (version === null) {
      context.addIssue({
        code: "custom",
        message: `MIN_CLIENT_BUILD must be a release version like ${fallback}, not "${spelled}"`,
      });
      return z.NEVER;
    }
    return version;
  });

/** A whole number of bytes past zero; blank takes the fallback. */
const byteCount = (fallback: number) =>
  optionalText
    .pipe(
      z
        .string()
        .regex(/^[1-9]\d*$/u, "a whole number of bytes past zero")
        .transform(Number)
        .pipe(z.int())
        .optional(),
    )
    .transform((bytes) => bytes ?? fallback);

const GIB = 1024 ** 3;

const envSchema = z
  .object({
    APP_URL: origin,

    BETTER_AUTH_SECRET: optionalText,

    CRON_SECRET: optionalText,

    // the reset mail's sender, an address on a domain Resend has verified: `Name <address>`
    EMAIL_FROM: optionalText,

    // unset, production sends nothing and anywhere else logs (`auth/send-email.ts`): `log` writes
    // a live reset link to the server's log, which production's must never hold
    EMAIL_MODE: optionalText.pipe(z.enum(["resend", "log", "off"]).optional()),

    LIBRARY_STORAGE_CAP_BYTES: byteCount(GIB),

    MIN_CLIENT_BUILD: buildFloor("0.7.0"),

    // `@repo/db` reads it raw as well, since it opens its client on import
    POSTGRES_URL: postgresUrl,

    RATE_LIMIT_DISABLED: flag,

    RESEND_API_KEY: optionalText,
  })
  .superRefine((env, context) => {
    if (env.EMAIL_MODE !== "resend") {
      return;
    }
    if (env.RESEND_API_KEY === undefined) {
      context.addIssue({
        code: "custom",
        message: "EMAIL_MODE=resend sends through Resend, so it needs RESEND_API_KEY",
        path: ["RESEND_API_KEY"],
      });
    }
    if (env.EMAIL_FROM === undefined) {
      context.addIssue({
        code: "custom",
        message: "EMAIL_MODE=resend sends from EMAIL_FROM, so it needs one",
        path: ["EMAIL_FROM"],
      });
    }
  });

export const ENV_KEYS = envSchema.keyof().options;

export const parseEnv = (source: NodeJS.ProcessEnv) => envSchema.parse(source);

export const env = parseEnv(process.env);
