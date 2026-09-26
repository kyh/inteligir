import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudFetch } from "@repo/api/cloud/client";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { composeRuntime } from "@repo/mobile/lib/compose-runtime";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { openNodeSqlDriver } from "@repo/mobile/lib/node-sql-driver";
import type { AttachmentFiles } from "@repo/mobile/notes/attachment-files";
import type { OutboxFiles } from "@repo/mobile/notes/outbox-files";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const NOTE = "notes/plan.md";
const PHONE_NAME = "E2E Phone";
const MIRROR_DEADLINE_MS = 20_000;

// ten lines, so line 1 and line 10 are far apart and two edits of line 5 overlap
const plan = (edits: Record<number, string> = {}): string => {
  const lines = Array.from({ length: 10 }, (_, index) => `line ${String(index + 1)}`);
  return `${lines.map((line, index) => edits[index + 1] ?? line).join("\n")}\n`;
};

// the phone's files that are not the database: under node they live in memory, answered as the
// async ports they stand in for
const memoryFiles = (): AttachmentFiles & OutboxFiles => {
  const files = new Map<string, Uint8Array>();
  return {
    clear: () => {
      files.clear();
      return Promise.resolve();
    },
    find: (name) => Promise.resolve(files.has(name) ? `memory://${name}` : null),
    read: (name) => {
      const bytes = files.get(name);
      expect(bytes !== undefined, `the phone staged ${name}`);
      return Promise.resolve(bytes);
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
    save: (name, bytes) => {
      files.set(name, bytes);
      return Promise.resolve(`memory://${name}`);
    },
    stage: (name, bytes) => {
      files.set(name, bytes);
      return Promise.resolve();
    },
  };
};

// the scenario holds the phone's credential; the phone never signs out here
const heldCredential = (credential: DeviceCredential) => ({
  clear: () => Promise.resolve(),
  read: () => Promise.resolve(credential),
  write: () => Promise.resolve(),
});

// the phone's own runtime, the one the app composes, over node's sqlite and a network the
// scenario can take away
const phoneRuntime = async (
  origin: string,
  dir: string,
  credential: DeviceCredential,
  network: { online: boolean },
): Promise<AppRuntime> => {
  await mkdir(dir, { recursive: true });
  const fetch: CloudFetch = async (input, init) => {
    if (!network.online) {
      throw new Error("the phone is offline");
    }
    return await globalThis.fetch(input, init);
  };
  const files = memoryFiles();
  return composeRuntime({
    attachments: files,
    cloudUrl: origin,
    credentials: heldCredential(credential),
    db: openNodeSqlDriver(path.join(dir, "inteligir.db")),
    deviceName: PHONE_NAME,
    mintId: () => randomBytes(16).toString("hex"),
    outboxFiles: files,
    retryBaseMs: null,
    sha1: (bytes) => Promise.resolve(createHash("sha1").update(bytes).digest()),
    sync: {
      createClient: (signedIn) =>
        createCloudClient({ baseUrl: origin, credential: signedIn.credential, fetch }),
      pollIntervalMs: null,
    },
  });
};

const readNote = async (phone: AppRuntime, notePath: string): Promise<string> => {
  const read = await phone.notes.readNote(notePath);
  expect(read.ok, `the phone reads ${notePath}: ${read.ok ? "" : read.message}`);
  return read.content;
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
    await pollUntil(
      () => Promise.resolve(phone.notes.tree.get()),
      (tree) => tree.state === "ready" && tree.entries.some((entry) => entry.path === NOTE),
      {
        deadlineMs: MIRROR_DEADLINE_MS,
        describe: (tree) => `the phone's notes are still ${tree.state}`,
      },
    );
    expectEq(await readNote(phone, NOTE), plan(), "the phone's mirrored note");

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
    expectEq(await readNote(phone, NOTE), both, "the phone's note after the merge landed");
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
