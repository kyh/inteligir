import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ENV_KEYS, parseEnv } from "./env";

/** hashed for every task: a build under an ambient `development` is a dev bundle */
const TURBO_ONLY = ["NODE_ENV"];
/** drizzle-kit's, read outside env.ts */
const EXAMPLE_ONLY = ["POSTGRES_URL_NON_POOLING"];

const turboSchema = z.object({ globalEnv: z.array(z.string()) });

// turbo.json's comments each take a line of their own
const withoutComments = (jsonc: string) => jsonc.replaceAll(/^\s*\/\/.*$/gmu, "");

const repoFile = (name: string) =>
  readFileSync(new URL(`../../../${name}`, import.meta.url), "utf-8");

const exampleKeys = (text: string) =>
  text.split("\n").flatMap((line) => {
    const key = /^(?:# )?(?<key>[A-Z][A-Z\d_]*)=/u.exec(line)?.groups?.key;
    return key === undefined ? [] : [key];
  });

describe("env", () => {
  it("defaults what it may and leaves the rest unset", () => {
    const env = parseEnv({});
    expect(env.MIN_CLIENT_BUILD).toStrictEqual({ major: 0, minor: 7, patch: 0, prerelease: false });
    expect(env.LIBRARY_STORAGE_CAP_BYTES).toBe(1_073_741_824);
    expect(env.EMAIL_MODE).toBe("off");
    expect(env.RATE_LIMIT_DISABLED).toBe(false);
    expect(env.APP_URL).toBeUndefined();
    expect(env.POSTGRES_URL).toBeUndefined();
  });

  it("reads a blank secret as unset, so its feature stays off", () => {
    const blank = parseEnv({ BETTER_AUTH_SECRET: "", CRON_SECRET: "  ", RESEND_API_KEY: " " });
    expect(blank.CRON_SECRET).toBeUndefined();
    expect(blank.BETTER_AUTH_SECRET).toBeUndefined();
    expect(blank.RESEND_API_KEY).toBeUndefined();
    expect(parseEnv({ CRON_SECRET: "s3cret" }).CRON_SECRET).toBe("s3cret");
  });

  it("keeps APP_URL to its origin", () => {
    expect(parseEnv({ APP_URL: "https://inteligir.vercel.app/library/" }).APP_URL).toBe(
      "https://inteligir.vercel.app",
    );
    expect(() => parseEnv({ APP_URL: "ftp://inteligir.com" })).toThrow();
  });

  it("takes a Postgres URL alone", () => {
    const url = "postgresql://postgres:postgres@127.0.0.1:54622/postgres";
    expect(parseEnv({ POSTGRES_URL: url }).POSTGRES_URL).toBe(url);
    expect(() => parseEnv({ POSTGRES_URL: "mysql://127.0.0.1/db" })).toThrow();
  });

  it("reads the build floor as a release version, and refuses anything else", () => {
    expect(parseEnv({ MIN_CLIENT_BUILD: "0.9.1" }).MIN_CLIENT_BUILD).toStrictEqual({
      major: 0,
      minor: 9,
      patch: 1,
      prerelease: false,
    });
    expect(() => parseEnv({ MIN_CLIENT_BUILD: "0.9" })).toThrow(/release version/u);
    expect(() => parseEnv({ MIN_CLIENT_BUILD: "0.9.1-beta" })).toThrow(/release version/u);
  });

  it("reads the storage cap as whole bytes past zero", () => {
    expect(parseEnv({ LIBRARY_STORAGE_CAP_BYTES: "1048576" }).LIBRARY_STORAGE_CAP_BYTES).toBe(
      1_048_576,
    );
    for (const spelled of ["0", "-1", "1GB", "1.5", "99999999999999999999"]) {
      expect(() => parseEnv({ LIBRARY_STORAGE_CAP_BYTES: spelled })).toThrow();
    }
  });

  it("takes only the exact words for a flag", () => {
    expect(parseEnv({ RATE_LIMIT_DISABLED: "true" }).RATE_LIMIT_DISABLED).toBe(true);
    expect(parseEnv({ RATE_LIMIT_DISABLED: "false" }).RATE_LIMIT_DISABLED).toBe(false);
    for (const spelled of ["TRUE", "1", "yes"]) {
      expect(() => parseEnv({ RATE_LIMIT_DISABLED: spelled })).toThrow();
    }
  });

  it("sends through Resend only with its key, and knows no other mode", () => {
    expect(parseEnv({ EMAIL_MODE: "log" }).EMAIL_MODE).toBe("log");
    expect(parseEnv({ EMAIL_MODE: "resend", RESEND_API_KEY: "re_1" }).EMAIL_MODE).toBe("resend");
    expect(() => parseEnv({ EMAIL_MODE: "resend" })).toThrow(/RESEND_API_KEY/u);
    expect(() => parseEnv({ EMAIL_MODE: "smtp" })).toThrow();
  });

  // turbo passes a key set in the real environment (CI, Vercel) to a task only when globalEnv
  // lists it, and .env.example is the one list of keys a deployer reads
  it("is held to turbo.json's globalEnv and .env.example, key for key", () => {
    const { globalEnv } = turboSchema.parse(JSON.parse(withoutComments(repoFile("turbo.json"))));
    expect(globalEnv.toSorted()).toStrictEqual([...ENV_KEYS, ...TURBO_ONLY].toSorted());
    expect(exampleKeys(repoFile(".env.example")).toSorted()).toStrictEqual(
      [...ENV_KEYS, ...EXAMPLE_ONLY].toSorted(),
    );
  });
});
