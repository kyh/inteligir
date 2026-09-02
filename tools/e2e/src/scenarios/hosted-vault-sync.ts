// The hosted loop, end to end and for real: one wrangler-dev Worker (real
// workerd, real D1, a real durable-git repo cell), one account through the
// invite gate, and two instances whose vaults converge through the DERIVED
// hosted remote — no INTELIGIR_VAULT_REMOTE anywhere, the credential is the
// switch. Instance A pairs through the production browser flow (pairBegin →
// approve-page mint → its own /pair/callback); instance B gets its credential
// BEFORE boot, which is what makes it take the real clone path instead of
// init+seed. Two refusals get their own pins: a revoked credential reads
// "unauthorized" (never "offline"), and no token ever lands in .git/config.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEVICE_CREDENTIAL_PREFIX,
  generatePkceVerifier,
  mintPairingCodeResponseSchema,
  PAIR_APPROVE_PARAMS,
  PAIR_CALLBACK_PARAMS,
  pkceChallengeS256,
  redeemDeviceResponseSchema,
} from "@repo/api/cloud/pairing/pairing-schema";
import {
  readDeviceCredential,
  writeDeviceCredential,
} from "inteligir/server/cloud/credential-store";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { E2E_INVITE_CODE } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { InstanceApi } from "../harness/instance";
import type { Scenario } from "../harness/scenario";

const FROM_A = "# Shared\n\nWritten on A, pushed through the hosted remote.\n";
const FROM_B = "# Reply\n\nWritten on B, pulled back to A.\n";

const IDENTITY_DEADLINE_MS = 15_000;
const SYNC_DEADLINE_MS = 20_000;
const POLL_INTERVAL_MS = 200;

/** Auto-sync off on both instances: every sync below is an explicit call, so
 *  the state each assertion reads is the state the previous line produced. */
function cloudEnv(origin: string) {
  return { INTELIGIR_CLOUD_URL: origin, INTELIGIR_SYNC_INTERVAL_MS: "0" };
}

const sessionUserSchema = z.looseObject({ user: z.looseObject({ id: z.string() }) });

/** An account through the production invite gate; the bearer is what the
 *  approve page's session would hold. */
async function signUp(origin: string): Promise<{ bearer: string; userId: string }> {
  const response = await fetch(`${origin}/v1/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      name: "E2E Owner",
      email: "e2e-owner@inteligir.local",
      password: "e2e-password-1234",
      inviteCode: E2E_INVITE_CODE,
    }),
  });
  expect(response.ok, `sign-up answered ${response.status}`);
  const bearer = response.headers.get("set-auth-token");
  expect(bearer !== null, "sign-up returned a session bearer");

  const session = await fetch(`${origin}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${bearer}`, origin },
  });
  const parsed = sessionUserSchema.safeParse(await session.json());
  expect(parsed.success, "get-session names the signed-up user");
  return { bearer, userId: parsed.data.user.id };
}

/** The approve page's act: mint a code with the session, bound to a PKCE
 *  challenge. */
async function mintCode(origin: string, bearer: string, challenge: string): Promise<string> {
  const response = await fetch(`${origin}/v1/device/code`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, origin, "content-type": "application/json" },
    body: JSON.stringify({ challenge, challengeMethod: "S256" }),
  });
  expect(response.ok, `mint answered ${response.status}`);
  return mintPairingCodeResponseSchema.parse(await response.json()).code;
}

/** A second device credential, minted wholly over HTTP — what a phone or
 *  another machine's own redeem would hold. */
async function redeemDevice(
  origin: string,
  bearer: string,
  deviceName: string,
): Promise<{ deviceId: string; credential: string }> {
  const verifier = generatePkceVerifier();
  const code = await mintCode(origin, bearer, await pkceChallengeS256(verifier));
  const response = await fetch(`${origin}/v1/device/redeem`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName, verifier }),
  });
  expect(response.ok, `redeem answered ${response.status}`);
  return redeemDeviceResponseSchema.parse(await response.json());
}

async function revokeDevice(origin: string, bearer: string, deviceId: string): Promise<void> {
  const response = await fetch(`${origin}/v1/device/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, origin, "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  expect(response.ok, `revoke answered ${response.status}`);
}

/** A parameter the approve URL must carry — asserted where it is read, so a
 *  missing one fails HERE rather than as a 400 one call later. */
function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  expect(value !== null, `the approve URL carries ${key}`);
  return value;
}

/** Drive the production pairing loop for a booted instance: pairBegin, the
 *  approve page's mint, then the browser's own GET of the local callback. */
async function pairThroughBrowserFlow(
  api: InstanceApi,
  origin: string,
  bearer: string,
): Promise<void> {
  const begun = await api.cloud.pairBegin({ openBrowser: false });
  const approve = new URL(begun.url);
  const state = requiredParam(approve, PAIR_APPROVE_PARAMS.state);
  const challenge = requiredParam(approve, PAIR_APPROVE_PARAMS.challenge);
  const redirect = requiredParam(approve, PAIR_APPROVE_PARAMS.redirect);

  const code = await mintCode(origin, bearer, challenge);
  const callback = new URL(redirect);
  callback.searchParams.set(PAIR_CALLBACK_PARAMS.code, code);
  callback.searchParams.set(PAIR_CALLBACK_PARAMS.state, state);
  const answered = await fetch(callback);
  expect(answered.ok, `the pair callback answered ${answered.status}`);
}

/** The account identity lands asynchronously after pairing (`/v1/account`),
 *  and the vault's cross-account fence fails closed until it does. */
async function untilIdentityKnown(api: InstanceApi, label: string): Promise<void> {
  const deadline = Date.now() + IDENTITY_DEADLINE_MS;
  for (;;) {
    const status = await api.cloud.status();
    if (status.state === "paired" && status.accountEmail !== null) {
      return;
    }
    expect(
      Date.now() < deadline,
      `${label}: account identity did not land within ${IDENTITY_DEADLINE_MS}ms (state: ${status.state})`,
    );
    await delay(POLL_INTERVAL_MS);
  }
}

/**
 * Sync until the engine settles on `wanted`. A single call is not enough on
 * purpose: `syncNow` is single-flight, so a call landing while a background
 * pass runs (the identity re-kick, a ws ping from the other device's push)
 * JOINS that pass and reports the state it left — which can be "dirty" for a
 * write the joined pass never saw. Retrying issues a real pass. Every state
 * outside the transitional set fails immediately: "offline" after a revoke is
 * exactly the misreading this scenario exists to pin out.
 */
async function syncUntil(
  api: InstanceApi,
  label: string,
  wanted: "clean" | "unauthorized",
): Promise<void> {
  const transitional = new Set([
    "syncing",
    "dirty",
    ...(wanted === "unauthorized" ? ["clean"] : []),
  ]);
  const deadline = Date.now() + SYNC_DEADLINE_MS;
  for (;;) {
    const status = await api.vault.syncNow();
    if (status.state === wanted) {
      return;
    }
    expect(
      transitional.has(status.state),
      `${label}: expected "${wanted}", got "${status.state}" (lastError: ${status.lastError ?? "none"})`,
    );
    expect(
      Date.now() < deadline,
      `${label}: still "${status.state}" after ${SYNC_DEADLINE_MS}ms waiting for "${wanted}"`,
    );
    await delay(POLL_INTERVAL_MS);
  }
}

/** The epic's acceptance line verbatim: no token in any .git/config — not as
 *  the credential, not as URL userinfo. The credential compared is the LIVE
 *  one read back from the instance's own data dir, and the prefix sweep is
 *  the contract's constant — a hand-copied "igd_" would keep passing after a
 *  prefix change while the real secret sat in the config. */
async function expectNoTokenInGitConfig(
  vaultDir: string,
  dataDir: string,
  label: string,
): Promise<void> {
  const config = await readFile(join(vaultDir, ".git", "config"), "utf8");
  const stored = readDeviceCredential(dataDir);
  expect(stored !== null, `${label}: a device credential is on disk to compare against`);
  expect(
    !config.includes(stored.credential),
    `${label}: .git/config never carries the live credential`,
  );
  expect(
    !config.includes(DEVICE_CREDENTIAL_PREFIX),
    `${label}: .git/config carries no device credential`,
  );
  expect(!/https?:\/\/[^\n]*@/.test(config), `${label}: .git/config carries no URL userinfo`);
  expect(!config.toLowerCase().includes("extraheader"), `${label}: auth rides env, never config`);
}

export const hostedVaultSync: Scenario = {
  name: "hosted-vault-sync",
  description: "two instances against a real dev Worker: pair, converge, clone, revoke",
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account through the invite gate");
    const { bearer, userId } = await signUp(worker.origin);

    ctx.log("A boots accountless, then pairs through the production flow");
    const a = await ctx.boot({ name: "a", extraEnv: cloudEnv(worker.origin) });
    await pairThroughBrowserFlow(a.api, worker.origin, bearer);
    await untilIdentityKnown(a.api, "A");

    ctx.log("A writes and pushes through the derived hosted remote");
    await a.api.vault.write({ path: "notes/shared.md", content: FROM_A });
    await syncUntil(a.api, "A after write", "clean");

    ctx.log("B holds a credential BEFORE boot: the clone path, not init+seed");
    const deviceB = await redeemDevice(worker.origin, bearer, "E2E Device B");
    const b = await ctx.boot({
      name: "b",
      extraEnv: cloudEnv(worker.origin),
      // Through the harness's own hook: the instance layout is the
      // launcher's, and a path rebuilt here would silently send B down the
      // init+seed path the assertions below exist to refuse.
      seedData: (dataDir) => writeDeviceCredential(dataDir, { ...deviceB, userId }),
    });

    expect(
      existsSync(join(b.vaultDir, "notes", "shared.md")),
      "B's boot clone brought A's note down",
    );
    expectEq(
      await readFile(join(b.vaultDir, "notes", "shared.md"), "utf8"),
      FROM_A,
      "B's on-disk content",
    );
    // A CLONE, not a seed-then-merge: B's history IS A's history, byte for
    // byte — a seeded B would hold its own root commit that no rebase erases.
    const headA = await exec("git", ["-C", a.vaultDir, "rev-parse", "HEAD"], {
      env: hermeticProcessEnv(),
    });
    const headB = await exec("git", ["-C", b.vaultDir, "rev-parse", "HEAD"], {
      env: hermeticProcessEnv(),
    });
    expectEq(headB.stdout.trim(), headA.stdout.trim(), "B's clone landed on A's own HEAD");
    const marker = await exec("git", ["-C", b.vaultDir, "config", "--get", "inteligir.account"], {
      env: hermeticProcessEnv(),
    });
    expectEq(marker.stdout.trim(), userId, "B's clone pinned the account marker");

    ctx.log("B writes; the change reaches A the other way around");
    await b.api.vault.write({ path: "notes/from-b.md", content: FROM_B });
    await syncUntil(b.api, "B after write", "clean");
    await syncUntil(a.api, "A pulling B's write", "clean");
    expectEq(
      await readFile(join(a.vaultDir, "notes", "from-b.md"), "utf8"),
      FROM_B,
      "A's on-disk content",
    );

    await expectNoTokenInGitConfig(a.vaultDir, a.dataDir, "A");
    await expectNoTokenInGitConfig(b.vaultDir, b.dataDir, "B");

    ctx.log("revoking B: the next sync must read unauthorized, not offline");
    await revokeDevice(worker.origin, bearer, deviceB.deviceId);
    await b.api.vault.write({ path: "notes/after-revoke.md", content: "# Stranded\n" });
    await syncUntil(b.api, "B after revoke", "unauthorized");

    ctx.log("A is untouched by B's revocation");
    await syncUntil(a.api, "A after B's revoke", "clean");
  },
};
