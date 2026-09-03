import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEVICE_CREDENTIAL_PREFIX,
  deviceLoginResponseSchema,
} from "@repo/api/cloud/device/device-schema";
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

// auto-sync off: every sync is an explicit call, so each assertion reads the state the previous
// line produced.
function cloudEnv(origin: string) {
  return { INTELIGIR_CLOUD_URL: origin, INTELIGIR_SYNC_INTERVAL_MS: "0" };
}

const sessionUserSchema = z.looseObject({ user: z.looseObject({ id: z.string() }) });

// the account every device signs in as; the password is what login needs
const OWNER = { email: "e2e-owner@inteligir.local", password: "e2e-password-1234" };

async function signUp(origin: string): Promise<{ bearer: string; userId: string }> {
  const response = await fetch(`${origin}/v1/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ name: "E2E Owner", ...OWNER, inviteCode: E2E_INVITE_CODE }),
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

async function loginDevice(
  origin: string,
  deviceName: string,
): Promise<{ deviceId: string; credential: string }> {
  const response = await fetch(`${origin}/v1/device/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ ...OWNER, deviceName }),
  });
  expect(response.ok, `login answered ${response.status}`);
  return deviceLoginResponseSchema.parse(await response.json());
}

async function revokeDevice(origin: string, bearer: string, deviceId: string): Promise<void> {
  const response = await fetch(`${origin}/v1/device/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, origin, "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  expect(response.ok, `revoke answered ${response.status}`);
}

// the account identity lands asynchronously after the login, and the cross-account fence fails closed
// until it does.
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

// syncNow is single-flight: a call landing during a background pass joins it and reports the state
// it left, which can be "dirty" for a write that pass never saw, so retry; any other state fails at
// once.
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

// compares the live credential read back from the data dir and the contract's prefix constant: a
// hand-copied "igd_" would keep passing after a prefix change.
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
  description: "two instances against a real dev Worker: sign in, converge, clone, revoke",
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account through the invite gate");
    const { bearer, userId } = await signUp(worker.origin);

    ctx.log("A boots accountless, then signs in through the production route");
    const a = await ctx.boot({ name: "a", extraEnv: cloudEnv(worker.origin) });
    const signedIn = await a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" });
    expect(signedIn.state === "paired", `A's login answered ${signedIn.state}`);
    await untilIdentityKnown(a.api, "A");

    ctx.log("A writes and pushes through the derived hosted remote");
    await a.api.vault.write({ path: "notes/shared.md", content: FROM_A });
    await syncUntil(a.api, "A after write", "clean");

    ctx.log("B holds a credential BEFORE boot: the clone path, not init+seed");
    const deviceB = await loginDevice(worker.origin, "E2E Device B");
    const b = await ctx.boot({
      name: "b",
      extraEnv: cloudEnv(worker.origin),
      // through the harness hook: a path rebuilt here would send B down the init+seed path instead
      // of the clone.
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
    // a clone, not seed-then-merge: a seeded B would hold its own root commit no rebase erases.
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
