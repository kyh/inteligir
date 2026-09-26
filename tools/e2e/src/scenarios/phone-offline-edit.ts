import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import { PHONE_NAME, phoneRuntime, readPhoneNote, untilMirrored } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

const NOTE = "notes/plan.md";

// ten lines, so line 1 and line 10 are far apart and two edits of line 5 overlap
const plan = (edits: Record<number, string> = {}): string => {
  const lines = Array.from({ length: 10 }, (_, index) => `line ${String(index + 1)}`);
  return `${lines.map((line, index) => edits[index + 1] ?? line).join("\n")}\n`;
};

export const phoneOfflineEdit: Scenario = {
  description:
    "the phone's own runtime edits a note offline while A edits it too: after reconnecting, a far edit lands merged with A's, and a same-line one keeps both versions",
  name: "phone-offline-edit",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account; A signs in and pushes the note");
    await signUp(worker.origin);
    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    const signedIn = await a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" });
    expect(signedIn.state === "signed-in", `A's login answered ${signedIn.state}`);
    await untilIdentityKnown(a.api, "A");
    await a.api.vault.write({ content: plan(), guard: { kind: "overwrite" }, path: NOTE });
    await syncUntil(a.api, "A after write", "clean");

    ctx.log("the phone signs in and mirrors the vault");
    const network = { online: true };
    const phone = await phoneRuntime(
      worker.origin,
      path.join(ctx.scratchDir, "phone"),
      await loginDevice(worker.origin, PHONE_NAME),
      network,
    );
    await phone.start();
    await untilMirrored(phone, [NOTE]);
    expectEq(await readPhoneNote(phone, NOTE), plan(), "the phone's mirrored note");

    ctx.log("offline, the phone edits line 1 while A edits line 10 and syncs");
    network.online = false;
    await phone.notes.write(NOTE, plan({ 1: "the phone's line 1" }));
    await a.api.vault.write({
      content: plan({ 10: "A's line 10" }),
      guard: { kind: "overwrite" },
      path: NOTE,
    });
    await syncUntil(a.api, "A after its far edit", "clean");

    ctx.log("the phone reconnects, and A syncs a note holding both edits");
    network.online = true;
    await phone.notes.drain();
    expectEq(phone.notes.outbox.status.get().unsent, 0, "the phone's unsent edits");
    await syncUntil(a.api, "A pulling the phone's merge", "clean");
    const both = plan({ 1: "the phone's line 1", 10: "A's line 10" });
    expectEq(await readFile(path.join(a.vaultDir, NOTE), "utf-8"), both, "A's note");

    ctx.log("offline again, both rewrite line 5");
    expectEq(await readPhoneNote(phone, NOTE), both, "the phone's note after the merge landed");
    network.online = false;
    const fromPhone = plan({ 1: "the phone's line 1", 5: "the phone's line 5", 10: "A's line 10" });
    const fromA = plan({ 1: "the phone's line 1", 5: "A's line 5", 10: "A's line 10" });
    await phone.notes.write(NOTE, fromPhone);
    await a.api.vault.write({ content: fromA, guard: { kind: "overwrite" }, path: NOTE });
    await syncUntil(a.api, "A after its same-line edit", "clean");

    ctx.log("the phone reconnects: its version stays, and A's is kept as the named copy");
    network.online = true;
    await phone.notes.drain();
    const { conflicts, unsent } = phone.notes.outbox.status.get();
    expectEq(unsent, 0, "the phone's unsent edits");
    const [copied] = conflicts;
    expect(copied?.copyPath !== null && copied?.copyPath !== undefined, "the phone names a copy");
    await syncUntil(a.api, "A pulling the phone's set", "clean");
    expectEq(await readFile(path.join(a.vaultDir, NOTE), "utf-8"), fromPhone, "A's note");
    expectEq(
      await readFile(path.join(a.vaultDir, copied.copyPath), "utf-8"),
      fromA,
      "the copy of A's version",
    );
    await exec("git", ["-C", a.vaultDir, "fsck", "--strict"], { env: hermeticProcessEnv() });
  },
};
