import { parseReleaseVersion } from "@repo/contract/client-build";
import { z } from "zod";

const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();

    return trimmed === "" ? undefined : trimmed;
  });

const flag = z.stringbool({ case: "sensitive", falsy: ["false"], truthy: ["true"] }).default(false);

const origin = optionalText.pipe(
  z
    .url({ protocol: /^https?$/u })
    .transform((url) => new URL(url).origin)
    .optional(),
);

const postgresUrl = optionalText.pipe(z.url({ protocol: /^postgres(?:ql)?$/u }).optional());

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
    AGENT_MOCK_MODEL: flag,

    AI_GATEWAY_API_KEY: optionalText,

    APP_URL: origin,

    BETTER_AUTH_SECRET: optionalText,

    BLOB_READ_WRITE_TOKEN: optionalText,

    CRON_SECRET: optionalText,

    EMAIL_FROM: optionalText,

    // WARNING: `log` writes a live sign-in code to the server's log, which production's must never hold
    EMAIL_MODE: optionalText.pipe(z.enum(["resend", "log", "off"]).optional()),

    FILE_STORE_DIR: optionalText.transform((dir) => dir ?? ".data/files"),

    LIBRARY_STORAGE_CAP_BYTES: byteCount(GIB),

    // WARNING: the next release owes the floor: /v1 dropped folders.write and the folder fields 0.7.0 reads, and account.delete takes a code, not the password
    MIN_CLIENT_BUILD: buildFloor("0.7.0"),

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

export const parseEnv = (source: NodeJS.ProcessEnv) => {
  const parsed = envSchema.parse(source);

  if (parsed.AGENT_MOCK_MODEL && source.VERCEL === "1") {
    throw new Error(
      "AGENT_MOCK_MODEL is for local runs: a deployment's agent answers with its model",
    );
  }

  return parsed;
};

export const env = parseEnv(process.env);
