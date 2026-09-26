import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCloudClient, describeCloudFailure } from "@repo/api/cloud/client";
import { DEVICE_CREDENTIAL_PREFIX } from "@repo/api/cloud/device/device-schema";
import {
  readDeviceCredential,
  writeDeviceCredential,
} from "inteligir/server/cloud/credential-store";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, revokeDevice, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import type { Scenario } from "../harness/scenario";

const SHARED_PATH = "notes/shared.md";
const FROM_A = "# Shared\n\nWritten on A, pushed through the hosted remote.\n";
const FROM_B = "# Reply\n\nWritten on B, pulled back to A.\n";
const EDITED_ON_A = "# Shared\n\nEdited on A.\n";
const EDITED_ON_B = "# Shared\n\nEdited on B.\n";
// A signed in as "E2E Device A", so its commits carry that name and B's merge copies A's
// version aside under it.
const COPY_OF_A = "notes/shared (conflict, E2E Device A).md";

// compares the live credential read back from the data dir and the contract's prefix constant: a
// hand-copied "igd_" would keep passing after a prefix change.
const expectNoTokenInGitConfig = async (
  vaultDir: string,
  dataDir: string,
  label: string,
): Promise<void> => {
  const config = await readFile(path.join(vaultDir, ".git", "config"), "utf-8");
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
  expect(!/https?:\/\/[^\n]*@/u.test(config), `${label}: .git/config carries no URL userinfo`);
  expect(!config.toLowerCase().includes("extraheader"), `${label}: auth rides env, never config`);
};

export const hostedVaultSync: Scenario = {
  description: "two instances against a real dev Worker: sign in, converge, clone, revoke",
  name: "hosted-vault-sync",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account through the invite gate");
    const { bearer, userId } = await signUp(worker.origin);

    ctx.log("A boots accountless, then signs in through the production route");
    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    const signedIn = await a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" });
    expect(signedIn.state === "signed-in", `A's login answered ${signedIn.state}`);
    await untilIdentityKnown(a.api, "A");

    ctx.log("A writes and pushes through the derived hosted remote");
    await a.api.vault.write({
      content: FROM_A,
      guard: { kind: "overwrite" },
      path: SHARED_PATH,
    });
    await syncUntil(a.api, "A after write", "clean");

    ctx.log("a phone lists A's note under git's own blob id, and reads it in one batch");
    const phone = await loginDevice(worker.origin, "E2E Phone");
    const phoneClient = createCloudClient({ baseUrl: worker.origin, credential: phone.credential });
    const tree = await phoneClient.vaultTree({});
    expect(tree.ok, `the phone's tree read: ${tree.ok ? "" : describeCloudFailure(tree.failure)}`);
    const listed = tree.value.entries.find((entry) => entry.path === SHARED_PATH);
    expect(listed !== undefined, "the phone's tree lists A's note");
    const blob = await exec(
      "git",
      ["-C", a.vaultDir, "rev-parse", `${tree.value.commit}:${SHARED_PATH}`],
      { env: hermeticProcessEnv() },
    );
    expectEq(listed.oid, blob.stdout.trim(), "the listed oid");
    const batch = await phoneClient.vaultFiles({ paths: [SHARED_PATH], ref: tree.value.commit });
    expect(batch.ok, `the phone's batch: ${batch.ok ? "" : describeCloudFailure(batch.failure)}`);
    expectEq(batch.value.files.length, 1, "files in the phone's batch");
    expectEq(batch.value.files[0]?.content, FROM_A, "the batch's content");
    expectEq(batch.value.files[0]?.oid, listed.oid, "the batch's oid");

    ctx.log("B holds a credential BEFORE boot: the clone path, not init+seed");
    const deviceB = await loginDevice(worker.origin, "E2E Device B");
    const b = await ctx.boot({
      extraEnv: hostedVaultEnv(worker.origin),
      name: "b",
      // through the harness hook: a path rebuilt here would send B down the init+seed path instead
      // of the clone.
      seedData: (dataDir) => {
        writeDeviceCredential(dataDir, { ...deviceB, deviceName: "E2E Device B", userId });
      },
    });

    expect(
      existsSync(path.join(b.vaultDir, "notes", "shared.md")),
      "B's boot clone brought A's note down",
    );
    expectEq(
      await readFile(path.join(b.vaultDir, "notes", "shared.md"), "utf-8"),
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
    await b.api.vault.write({
      content: FROM_B,
      guard: { kind: "overwrite" },
      path: "notes/from-b.md",
    });
    await syncUntil(b.api, "B after write", "clean");
    await syncUntil(a.api, "A pulling B's write", "clean");
    expectEq(
      await readFile(path.join(a.vaultDir, "notes", "from-b.md"), "utf-8"),
      FROM_B,
      "A's on-disk content",
    );

    // B's edit lands first: A's push pings B, and a pass it runs before B's write would only pull.
    ctx.log("both edit one line: B keeps its own and copies A's aside under A's device name");
    await b.api.vault.write({
      content: EDITED_ON_B,
      guard: { kind: "overwrite" },
      path: SHARED_PATH,
    });
    await a.api.vault.write({
      content: EDITED_ON_A,
      guard: { kind: "overwrite" },
      path: SHARED_PATH,
    });
    await syncUntil(a.api, "A after its edit", "clean");
    await syncUntil(b.api, "B meeting A's edit", "clean");
    expectEq(
      await readFile(path.join(b.vaultDir, SHARED_PATH), "utf-8"),
      EDITED_ON_B,
      "B keeps its own edit",
    );
    expectEq(
      await readFile(path.join(b.vaultDir, COPY_OF_A), "utf-8"),
      EDITED_ON_A,
      "B's copy of A's version",
    );
    const merged = await b.api.vault.status();
    expectEq(merged.device, "E2E Device B", "B's own name");
    expect(
      merged.conflicts.some(
        (report) =>
          report.kind === "copied" &&
          report.copyPath === COPY_OF_A &&
          report.copyDevice === "E2E Device A" &&
          report.keptDevice === "E2E Device B",
      ),
      `B reports the copy it made (got ${JSON.stringify(merged.conflicts)})`,
    );
    await syncUntil(a.api, "A pulling B's merge", "clean");
    expectEq(
      await readFile(path.join(a.vaultDir, COPY_OF_A), "utf-8"),
      EDITED_ON_A,
      "A holds the copy B made",
    );
    expectEq(
      await readFile(path.join(a.vaultDir, SHARED_PATH), "utf-8"),
      EDITED_ON_B,
      "A converges on B's merge",
    );

    await expectNoTokenInGitConfig(a.vaultDir, a.dataDir, "A");
    await expectNoTokenInGitConfig(b.vaultDir, b.dataDir, "B");

    ctx.log("revoking B: the next sync must read unauthorized, not offline");
    await revokeDevice(worker.origin, bearer, deviceB.deviceId);
    await b.api.vault.write({
      content: "# Stranded\n",
      guard: { kind: "overwrite" },
      path: "notes/after-revoke.md",
    });
    await syncUntil(b.api, "B after revoke", "unauthorized");

    ctx.log("A is untouched by B's revocation");
    await syncUntil(a.api, "A after B's revoke", "clean");
  },
};
