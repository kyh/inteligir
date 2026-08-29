// `pnpm bootstrap:cloud` — the local CLOUD loop, provisioned in one command.
//
// The PRODUCT needs no bootstrap: `pnpm install && pnpm dev` is the whole
// setup, accountless and offline. The hosted half is the one place a fresh
// checkout pays a recipe by hand — sign-up is invite-gated with no self-serve
// issuance, the local D1 file is materialized lazily by the first request that
// touches the binding, and a device credential exists only after a pairing. So
// this script provisions the ACCOUNT SIDE and nothing else, against the Worker
// `pnpm dev:web` is already serving.
//
// IT PAIRS WITHOUT A BROWSER AND WITHOUT A RUNNING LOCAL SERVER. The product's
// own flow sends a browser to the approve page and back to the local app's
// `/pair/callback`; `--pair` performs the two acts that flow exists to carry —
// the approve page's mint and the callback's PKCE-bound redeem — with the
// session it just opened, and writes the credential into this checkout's data
// dir. That is what lets the loop come up in the order a fresh checkout runs
// it: the Worker, then this, then `inteligir serve`, which boots entitled.
//
// EVERY STEP IS IDEMPOTENT. The account is signed INTO when it already exists,
// the invite code is fresh on every run so its primary key cannot collide, and
// a credential the cloud still accepts is left alone. Nothing prompts, so it
// runs headless.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_API_PATHS,
  type AccountResponse,
  accountResponseSchema,
} from "@repo/api/cloud/account/account-schema";
import {
  DEVICE_API_PATHS,
  DEVICE_NAME_MAX_LENGTH,
  generatePkceVerifier,
  type MintPairingCodeRequest,
  mintPairingCodeResponseSchema,
  pkceChallengeS256,
  type RedeemDeviceRequest,
  redeemDeviceResponseSchema,
} from "@repo/api/cloud/pairing/pairing-schema";
import {
  readDeviceCredential,
  writeDeviceCredential,
} from "inteligir/server/cloud/credential-store";
import { CONFIG_FILE_NAME, resolveAppConfig, resolveCheckoutRoot } from "inteligir/server/config";
import { readServerFile } from "inteligir/server/server-file";
import { z } from "zod";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The one dev account this script owns. Local-only in every sense: it lives in
 * the miniflare D1 under `apps/web/.wrangler`, and the password is a fixture
 * rather than a secret precisely so a second run can sign back in with it.
 */
const DEV_ACCOUNT = {
  name: "inteligir dev",
  email: "dev@inteligir.local",
  password: "inteligir-dev-password",
} as const;

const WORKER_DEADLINE_MS = 90_000;
const WORKER_POLL_INTERVAL_MS = 500;
const WORKER_PROBE_TIMEOUT_MS = 2_000;

/**
 * One field out of a repo file, by the pattern that names it.
 *
 * `wrangler.jsonc` carries comments and trailing commas and `vite.config.ts`
 * is code, so neither can be parsed for the single value needed here — and a
 * hand-copied database name or port is a bootstrap that provisions a database
 * the dev server never opens, or dials a port nothing is bound to. A pattern
 * that stops matching fails loudly and says where to look.
 */
function fieldOf(relativePath: string, pattern: RegExp, what: string): string {
  const found = pattern.exec(readFileSync(join(REPO_ROOT, relativePath), "utf8"))?.[1];
  if (found === undefined) {
    throw new Error(
      `${relativePath} no longer names ${what}.\n` +
        `  rule: scripts/bootstrap-cloud.ts derives it from that file rather than keeping a copy\n` +
        `  fix: point the pattern /${pattern.source}/ at the field's new spelling`,
    );
  }
  return found;
}

/** What `wrangler d1 execute` addresses. */
const D1_DATABASE = fieldOf(
  "apps/web/wrangler.jsonc",
  /"database_name"\s*:\s*"([^"]+)"/,
  "the D1 database its binding names",
);

/** Where `pnpm dev:web` answers. The port is pinned with `strictPort`, so a
 *  stale process holding it fails that command rather than moving the Worker. */
const WEB_DEV_ORIGIN = `http://localhost:${fieldOf(
  "apps/web/vite.config.ts",
  /server:\s*\{\s*port:\s*(\d+)/,
  "the pinned dev port",
)}`;

interface Options {
  /** Also mint, redeem and store a device credential for this checkout. */
  pair: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { pair: false };
  for (const arg of argv) {
    if (arg === "--pair") {
      options.pair = true;
      continue;
    }
    throw new Error(`Unknown argument "${arg}" — bootstrap:cloud takes --pair and nothing else.`);
  }
  return options;
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** A child that inherits this terminal: drizzle-kit and wrangler explain their
 *  own failures far better than an exit code relayed after the fact. */
function runCommand(file: string, argv: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...argv], { cwd: REPO_ROOT, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`\`${file} ${argv.join(" ")}\` exited ${signal ?? String(code)}`));
    });
  });
}

/** A refusal, with whatever the route said about it. */
async function failed(response: Response, what: string): Promise<Error> {
  const body = (await response.text()).trim();
  const detail = body === "" ? "" : ` — ${body.slice(0, 300)}`;
  return new Error(`${what} answered ${String(response.status)}${detail}`);
}

/**
 * Wait for `pnpm dev:web`.
 *
 * `/v1/capabilities` rather than an auth route, because Better Auth is rate
 * limited per IP and a poll loop would spend the whole window before this
 * script makes its first real request. The single auth call below is what
 * MATERIALIZES the local D1 file — miniflare creates it on the first request
 * that touches the binding, and `db:push:local` resolves that file by name.
 */
async function untilWorkerAnswers(cloudUrl: string): Promise<void> {
  const deadline = Date.now() + WORKER_DEADLINE_MS;
  for (;;) {
    try {
      const probe = await fetch(`${cloudUrl}/v1/capabilities`, {
        signal: AbortSignal.timeout(WORKER_PROBE_TIMEOUT_MS),
      });
      await probe.text();
      const materialize = await fetch(`${cloudUrl}/api/auth/get-session`, {
        signal: AbortSignal.timeout(WORKER_PROBE_TIMEOUT_MS),
      });
      await materialize.text();
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(
          `Nothing answered at ${cloudUrl}. Start the Worker first:\n` +
            `  cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET\n` +
            `  pnpm dev:web`,
        );
      }
      await delay(WORKER_POLL_INTERVAL_MS);
    }
  }
}

/** Better Auth's own sign-in/sign-up body. Read for the account it names, so
 *  the identity costs no extra request against the limiter. */
const authenticatedUserSchema = z.looseObject({
  user: z.looseObject({ id: z.string().min(1), email: z.string().min(1) }),
});

interface Session {
  /** The session bearer a non-browser client carries. */
  bearer: string;
  userId: string;
  email: string;
  /** True when this run created the account rather than signing back in. */
  created: boolean;
}

async function sessionFrom(response: Response, created: boolean): Promise<Session> {
  const bearer = response.headers.get("set-auth-token");
  if (bearer === null) {
    throw new Error("the auth route returned no set-auth-token header");
  }
  const parsed = authenticatedUserSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("the auth route did not name the account it authenticated");
  }
  return { bearer, userId: parsed.data.user.id, email: parsed.data.user.email, created };
}

/** The existing dev account, or null when there is none to sign into yet. */
async function signIn(cloudUrl: string): Promise<Session | null> {
  const response = await fetch(`${cloudUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: cloudUrl },
    body: JSON.stringify({ email: DEV_ACCOUNT.email, password: DEV_ACCOUNT.password }),
  });
  if (!response.ok) {
    await response.text();
    return null;
  }
  return await sessionFrom(response, false);
}

/**
 * A code, and the account it buys.
 *
 * A FRESH code every run: `code` is the invite table's primary key, so a
 * literal one is an insert that fails the second time anybody mints. The
 * EXPLICIT `--config` matters as much — after a build, `.wrangler/deploy`
 * redirects wrangler at the built config, and the row would land in a database
 * the dev server never opens.
 */
async function signUp(cloudUrl: string): Promise<Session> {
  const code = `dev-${randomUUID()}`;
  say(`minting an invite code (${code})`);
  await runCommand("pnpm", [
    "--filter",
    "@repo/web",
    "exec",
    "wrangler",
    "d1",
    "execute",
    D1_DATABASE,
    "--config",
    "wrangler.jsonc",
    "--local",
    "--command",
    `INSERT INTO invite_code (code) VALUES ('${code}')`,
  ]);

  say(`creating ${DEV_ACCOUNT.email}`);
  const response = await fetch(`${cloudUrl}/v1/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: cloudUrl },
    body: JSON.stringify({ ...DEV_ACCOUNT, inviteCode: code }),
  });
  if (!response.ok) {
    const refusal = await failed(response, "POST /v1/auth/sign-up");
    // Sign-in was already tried and refused, so the address being taken is the
    // one refusal a rerun cannot clear on its own: the password on that row is
    // not this script's fixture, and nothing here can learn it.
    throw new Error(
      `${refusal.message}\n` +
        `  If ${DEV_ACCOUNT.email} already exists locally under another password, drop it and rerun:\n` +
        `    pnpm --filter @repo/web exec wrangler d1 execute ${D1_DATABASE} --config wrangler.jsonc` +
        ` --local --command "DELETE FROM user WHERE email = '${DEV_ACCOUNT.email}'"`,
    );
  }
  return await sessionFrom(response, true);
}

/** Whatever the instance's config file holds. Read rather than overwritten:
 *  the file belongs to the instance, so setting one field must not drop the
 *  vault dir or the agent mode somebody else put there. */
const managedConfigSchema = z.looseObject({ cloudUrl: z.string().optional() });

function readManagedConfig(file: string) {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return managedConfigSchema.parse({});
  }
  return managedConfigSchema.parse(JSON.parse(raw));
}

/**
 * Point this checkout's instance at the local Worker, through the layer the
 * server itself reads. Without it `inteligir serve` pairs and syncs against
 * the deployed cloud, which is not what a local loop is for — and an
 * environment variable would have to be re-spelled on every command that
 * starts a server.
 */
function pointAtLocalCloud(dataDir: string, cloudUrl: string): boolean {
  const file = join(dataDir, CONFIG_FILE_NAME);
  const existing = readManagedConfig(file);
  if (existing.cloudUrl === cloudUrl) {
    return false;
  }
  writeFileSync(file, `${JSON.stringify({ ...existing, cloudUrl }, null, 2)}\n`, "utf8");
  return true;
}

/** Whose account a device credential syncs as, or null when the cloud refuses
 *  it — revoked, or minted against a database that has since been reset. */
async function readAccount(cloudUrl: string, credential: string): Promise<AccountResponse | null> {
  const response = await fetch(`${cloudUrl}${ACCOUNT_API_PATHS.account}`, {
    headers: { authorization: `Bearer ${credential}` },
  });
  if (!response.ok) {
    await response.text();
    return null;
  }
  const parsed = accountResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

/** The approve page's act: a one-time code bound to a PKCE challenge. */
async function mintPairingCode(
  cloudUrl: string,
  bearer: string,
  verifier: string,
): Promise<string> {
  const body: MintPairingCodeRequest = {
    challenge: await pkceChallengeS256(verifier),
    challengeMethod: "S256",
  };
  const response = await fetch(`${cloudUrl}${DEVICE_API_PATHS.mintCode}`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await failed(response, `POST ${DEVICE_API_PATHS.mintCode}`);
  }
  return mintPairingCodeResponseSchema.parse(await response.json()).code;
}

interface PairedDevice {
  deviceId: string;
  /** True when this run redeemed a code rather than keeping the credential the
   *  data dir already held. */
  minted: boolean;
}

/** The callback's act: spend the code with the verifier that never left here,
 *  and store what comes back where the sync runtime reads it. */
async function ensurePaired(
  cloudUrl: string,
  dataDir: string,
  session: Session,
): Promise<PairedDevice> {
  const existing = readDeviceCredential(dataDir);
  if (existing !== null) {
    const account = await readAccount(cloudUrl, existing.credential);
    if (account !== null && account.id === session.userId) {
      return { deviceId: existing.deviceId, minted: false };
    }
  }

  const verifier = generatePkceVerifier();
  const body: RedeemDeviceRequest = {
    code: await mintPairingCode(cloudUrl, session.bearer, verifier),
    deviceName: `${hostname()} (dev)`.slice(0, DEVICE_NAME_MAX_LENGTH).trim(),
    verifier,
  };
  const response = await fetch(`${cloudUrl}${DEVICE_API_PATHS.redeem}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await failed(response, `POST ${DEVICE_API_PATHS.redeem}`);
  }
  const device = redeemDeviceResponseSchema.parse(await response.json());
  writeDeviceCredential(dataDir, { ...device, userId: session.userId });
  return { deviceId: device.deviceId, minted: true };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cloudUrl = process.env.INTELIGIR_CLOUD_URL ?? WEB_DEV_ORIGIN;
  const dataDir = resolveAppConfig({
    checkoutPath: resolveCheckoutRoot(),
    env: process.env,
  }).dataDir;
  mkdirSync(dataDir, { recursive: true });

  say(`waiting for the Worker at ${cloudUrl}`);
  await untilWorkerAnswers(cloudUrl);

  say("applying the D1 auth schema");
  await runCommand("pnpm", ["--filter", "@repo/web", "run", "db:push:local"]);

  const session = (await signIn(cloudUrl)) ?? (await signUp(cloudUrl));
  const repointed = pointAtLocalCloud(dataDir, cloudUrl);
  const device = options.pair ? await ensurePaired(cloudUrl, dataDir, session) : null;

  say("");
  say(`  cloud     ${cloudUrl}`);
  say(`  account   ${session.email} (${session.created ? "created" : "existing"})`);
  say(`  bearer    ${session.bearer}`);
  say(`  data dir  ${dataDir}`);
  say(`  cloud url ${repointed ? "written to" : "already in"} ${CONFIG_FILE_NAME}`);
  say(
    device === null
      ? "  pairing   skipped — rerun with --pair to entitle this checkout"
      : `  pairing   device ${device.deviceId} (${device.minted ? "paired" : "already paired"})`,
  );
  say("");

  const running = readServerFile(dataDir);
  say(
    running === null
      ? "Next: pnpm cli serve (or pnpm dev for the shell)."
      : `A server for this checkout is already listening on :${String(running.port)} — restart it to pick this up.`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
