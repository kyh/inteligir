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
    // the built-in agent answers from eve's mock model, by the directives `@repo/service/agent/mock-
    // directives` reads: for local runs and the suites, never a deployment's
    AGENT_MOCK_MODEL: flag,

    // the AI Gateway's key off Vercel, where the deployment's OIDC token stands in for it; unset
    // there, the built-in agent is unavailable unless its mock model is on
    AI_GATEWAY_API_KEY: optionalText,

    APP_URL: origin,

    BETTER_AUTH_SECRET: optionalText,

    // the private Blob store's key, which Vercel sets on a project the store is connected to: set,
    // files are kept there (`files/file-store-of.ts`), and @vercel/blob reads it on its own
    BLOB_READ_WRITE_TOKEN: optionalText,

    CRON_SECRET: optionalText,

    // the reset mail's sender, an address on a domain Resend has verified: `Name <address>`
    EMAIL_FROM: optionalText,

    // unset, production sends nothing and anywhere else logs (`auth/send-email.ts`): `log` writes
    // a live reset link to the server's log, which production's must never hold
    EMAIL_MODE: optionalText.pipe(z.enum(["resend", "log", "off"]).optional()),

    // off Vercel, an eve server the app reaches its agent at directly, never taken on Vercel: unset,
    // the app's own `/eve/v1` serves it (`withEve`'s rewrite), whose one port `next build` fixes, so
    // the e2e names each worker's agent here
    EVE_BASE_URL: origin,

    // off Vercel with no Blob key, the folder files are kept in, from the server's working folder
    FILE_STORE_DIR: optionalText.transform((dir) => dir ?? ".data/files"),

    LIBRARY_STORAGE_CAP_BYTES: byteCount(GIB),

    // The next release owes the floor: `/v1` has no `/v1/socket` and no `account.socketTicket`, a
    // note's body lands by `library.items.saveBody` over the version it read, a file goes up by
    // `library.files.reserve` and `settle`, the agent's questions (`respond`) are gone, and what
    // moved comes from `library.changes`; `library.write` takes property ops alone, a CONFLICT
    // carries no data, an item's row no `kind`, its fields one `reading` where the three `fetch*`
    // were, Undo is `library.agent.undo` by thread and turn, `listing.page` asks by a scope, and a
    // list's `cursor` is a number.
    MIN_CLIENT_BUILD: buildFloor("0.7.0"),

    // the e2e's stand-in for the web, never taken on Vercel: an assistant's metadata document is
    // asked of it as `GET <relay>?url=<the address>`
    PAGE_FETCH_RELAY_URL: optionalText.pipe(z.url({ protocol: /^https?$/u }).optional()),

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
