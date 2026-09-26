import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { vaultStatusResponseSchema } from "@repo/api/local/vault/vault-schema";
import { resolveCliBinDir, toShellEnv } from "inteligir/server/agent-shell-env";
import { writeDeviceCredential } from "inteligir/server/cloud/credential-store";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import type { Scenario } from "../harness/scenario";

// a new vault's starter notes fit many times over; one attachment past it cannot. the attachment
// stays under git's 1 MiB postBuffer, so every git version declares the push's length and the
// Worker refuses it unread; a streamed push past the room is vault-git.test.ts's.
const CAP_BYTES = 512 * 1024;
const ATTACHMENT_BYTES = 768 * 1024;

const FIRST_PATH = "notes/first.md";
const LATER_PATH = "notes/later.md";

const FULL_MESSAGE = "Your cloud vault is full. New changes stay on this Mac.";

export const hostedVaultFull: Scenario = {
  description:
    "a 512 KiB hosted vault: an attachment past it leaves A full, a later note commits on A, and a second device clones neither",
  name: "hosted-vault-full",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker({
      vars: { VAULT_STORAGE_CAP_BYTES: String(CAP_BYTES) },
    });
    const { userId } = await signUp(worker.origin);

    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    const signedIn = await a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" });
    expect(signedIn.state === "signed-in", `A's login answered ${signedIn.state}`);
    await untilIdentityKnown(a.api, "A");

    ctx.log("A's first note reaches the hosted vault");
    await a.api.vault.write({
      content: "# First\n\nSynced before the vault filled.\n",
      guard: { kind: "overwrite" },
      path: FIRST_PATH,
    });
    await syncUntil(a.api, "A's first note", "clean");

    ctx.log("an attachment past the cap lands on A, and its sync is refused as full");
    const attachment = await a.api.vault.assetWrite({
      baseName: "scan.png",
      dir: "",
      file: new Blob([randomBytes(ATTACHMENT_BYTES)]),
    });
    const refused = await a.api.vault.syncNow();
    expectEq(
      refused.state,
      "full",
      `A's sync after the attachment (lastError: ${refused.lastError ?? "none"})`,
    );
    expectEq(refused.lastError, FULL_MESSAGE, "A's last error");

    ctx.log("a later note saves and commits on A, and the next sync still says full");
    await a.api.vault.write({
      content: "# Later\n\nWritten once the vault was full.\n",
      guard: { kind: "overwrite" },
      path: LATER_PATH,
    });
    await a.api.vault.commitNow({ paths: [LATER_PATH] });
    const committed = await exec(
      "git",
      ["-C", a.vaultDir, "log", "-1", "--format=%H", "--", LATER_PATH],
      { env: hermeticProcessEnv() },
    );
    expect(committed.stdout.trim() !== "", "A committed the later note");
    const stillFull = await a.api.vault.syncNow();
    expectEq(stillFull.state, "full", "A's sync after the later note");

    const cliBinDir = resolveCliBinDir(path.join(ctx.repoRoot, "apps", "cli", "bin"));
    expect(cliBinDir !== null, "the app resolves a CLI bin directory");
    const status = await exec("inteligir", ["vault", "status", "--json"], {
      env: {
        ...hermeticProcessEnv(),
        ...toShellEnv(
          { cliBinDir, connectedDirs: [], dataDir: a.dataDir, skillsDir: null },
          hermeticProcessEnv(),
        ),
      },
      timeoutMs: 60_000,
    });
    const reported = vaultStatusResponseSchema.parse(JSON.parse(status.stdout));
    expectEq(reported.state, "full", "`inteligir vault status --json` on A");
    expectEq(reported.lastError, FULL_MESSAGE, "the status's last error");

    ctx.log("B signs in and clones: A's first note, and neither the attachment nor the later note");
    const deviceB = await loginDevice(worker.origin, "E2E Device B");
    const b = await ctx.boot({
      extraEnv: hostedVaultEnv(worker.origin),
      name: "b",
      seedData: (dataDir) => {
        writeDeviceCredential(dataDir, { ...deviceB, deviceName: "E2E Device B", userId });
      },
    });
    expect(existsSync(path.join(b.vaultDir, FIRST_PATH)), "B's clone holds A's first note");
    expect(!existsSync(path.join(b.vaultDir, attachment.path)), "B's clone has no attachment");
    expect(!existsSync(path.join(b.vaultDir, LATER_PATH)), "B's clone has no later note");
  },
};
