import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCloudClient, describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudResult, VaultCommitOutcome } from "@repo/api/cloud/client";
import type { VaultCommitRequest } from "@repo/api/cloud/vault/vault-commit-schema";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import type { Scenario } from "../harness/scenario";

const NOTE = "notes/plan.md";
const PHONE_NAME = "E2E Phone";
const FROM_A = "# Plan\n\nWritten on A.\n";
const FROM_PHONE = "# Plan\n\nWritten on A.\n\nEdited on the phone.\n";
const A_AGAIN = "# Plan\n\nRewritten on A while the phone was away.\n";
const PHONE_STALE = "# Plan\n\nWritten on A.\n\nEdited on the phone, twice.\n";
const PHONE_MERGED = "# Plan\n\nRewritten on A while the phone was away.\n\nMerged on the phone.\n";

type Change = VaultCommitRequest["changes"][number];

const putNote = (base: string, text: string): Change => ({
  base,
  content: { encoding: "utf-8", text },
  op: "put",
  path: NOTE,
});

const committedOf = (
  result: CloudResult<VaultCommitOutcome>,
  label: string,
): Extract<VaultCommitOutcome, { kind: "committed" }> => {
  expect(result.ok, `${label}: ${result.ok ? "" : describeCloudFailure(result.failure)}`);
  expect(result.value.kind === "committed", `${label}: answered ${result.value.kind}`);
  return result.value;
};

const conflictOf = (
  result: CloudResult<VaultCommitOutcome>,
  label: string,
): Extract<VaultCommitOutcome, { kind: "conflict" }> => {
  expect(result.ok, `${label}: ${result.ok ? "" : describeCloudFailure(result.failure)}`);
  expect(result.value.kind === "conflict", `${label}: answered ${result.value.kind}`);
  return result.value;
};

const git = async (vaultDir: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await exec("git", ["-C", vaultDir, ...args], { env: hermeticProcessEnv() });
  return stdout.trim();
};

export const hostedVaultPhoneWrite: Scenario = {
  description:
    "a phone's change set lands in the hosted vault and reaches the desktop, and a stale one gets the desktop's bytes back",
  name: "hosted-vault-phone-write",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account; A signs in and pushes the note");
    await signUp(worker.origin);
    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    const signedIn = await a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" });
    expect(signedIn.state === "signed-in", `A's login answered ${signedIn.state}`);
    await untilIdentityKnown(a.api, "A");
    await a.api.vault.write({ content: FROM_A, guard: { kind: "overwrite" }, path: NOTE });
    await syncUntil(a.api, "A after write", "clean");

    ctx.log("a second login plays the phone: it reads the note and commits an edit on its blob");
    const phone = await loginDevice(worker.origin, PHONE_NAME);
    const client = createCloudClient({ baseUrl: worker.origin, credential: phone.credential });
    const read = await client.vaultFile({ path: NOTE });
    expect(read.ok, `the phone's read: ${read.ok ? "" : describeCloudFailure(read.failure)}`);
    expectEq(read.value.content, FROM_A, "the phone's read");
    const first = committedOf(
      await client.vaultCommit({ changes: [putNote(read.value.oid, FROM_PHONE)] }),
      "the phone's commit",
    );
    const [landed] = first.results;
    expect(landed?.oid !== null && landed?.oid !== undefined, "the commit names the note's blob");

    ctx.log("A syncs clean with the phone's bytes, and its history names the phone");
    await syncUntil(a.api, "A pulling the phone's commit", "clean");
    expectEq(await readFile(path.join(a.vaultDir, NOTE), "utf-8"), FROM_PHONE, "A's note");
    const history = await a.api.vault.history({ path: NOTE });
    expectEq(history.revisions[0]?.authorName, PHONE_NAME, "the newest revision's author");

    ctx.log("A edits the same note; the phone's commit on its stale blob gets A's bytes back");
    await a.api.vault.write({ content: A_AGAIN, guard: { kind: "overwrite" }, path: NOTE });
    await syncUntil(a.api, "A after its edit", "clean");
    const refused = conflictOf(
      await client.vaultCommit({ changes: [putNote(landed.oid, PHONE_STALE)] }),
      "the phone's stale commit",
    );
    const [conflict] = refused.conflicts;
    expectEq(conflict?.path, NOTE, "the conflicted path");
    expectEq(conflict?.reason, "changed", "the conflict's reason");
    expectEq(conflict?.current?.content, A_AGAIN, "the bytes the conflict carries");
    expectEq(
      conflict?.device,
      await git(a.vaultDir, ["log", "-1", "--format=%cn", "--", NOTE]),
      "the device the conflict names",
    );
    expectEq(refused.head, await git(a.vaultDir, ["rev-parse", "HEAD"]), "the conflict's head");

    ctx.log("the phone recommits on the blob the conflict named, and A converges on it");
    const current = conflict?.current;
    expect(current !== null && current !== undefined, "the conflict names A's blob");
    const second = committedOf(
      await client.vaultCommit({ changes: [putNote(current.oid, PHONE_MERGED)] }),
      "the phone's recommit",
    );
    await syncUntil(a.api, "A pulling the phone's recommit", "clean");
    expectEq(await readFile(path.join(a.vaultDir, NOTE), "utf-8"), PHONE_MERGED, "A's note");
    expectEq(await git(a.vaultDir, ["rev-parse", "HEAD"]), second.commit, "A's head");
    await git(a.vaultDir, ["fsck", "--strict"]);
  },
};
