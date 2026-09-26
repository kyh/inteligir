import { randomBytes } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import { PHONE_NAME, phoneRuntime, untilMirrored } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

const PLAN = "notes/plan.md";
const HUB = "hub.md";
const OLD = "notes/old.md";
const COMMENTS_DIR = ".inteligir/comments";
const PHOTO_NAME = "Photo 2026-09-26 14.30.05.jpg";

// a JPEG's own start and end around a phone photo's worth of bytes: the vault reads the name, and
// what crosses is what lands
const photoBytes = (): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(900 * 1024), 0xff, 0xd9]);

const exists = async (file: string): Promise<boolean> => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const commentStores = async (vaultDir: string): Promise<string[]> => {
  const dir = path.join(vaultDir, COMMENTS_DIR);
  return (await exists(dir)) ? await readdir(dir) : [];
};

export const phoneFileOpsHosted: Scenario = {
  description:
    "the phone's own runtime creates a note, renames one another note links to, deletes one with comments and adds a photo; A syncs the rewritten link, the old name as an alias, no comment store and the photo's bytes",
  name: "phone-file-ops-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account; A signs in and pushes a linked note and one with a comment");
    await signUp(worker.origin);
    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    const signedIn = await a.api.cloud.login({ ...OWNER, deviceName: "E2E Device A" });
    expect(signedIn.state === "signed-in", `A's login answered ${signedIn.state}`);
    await untilIdentityKnown(a.api, "A");
    for (const note of [
      { content: "# Plan\n", path: PLAN },
      { content: "See [[plan]] for the details.\n", path: HUB },
      { content: "# Old\n\nA thought.\n", path: OLD },
    ]) {
      await a.api.vault.write({ ...note, guard: { kind: "overwrite" } });
    }
    // the starter vault ships comment stores of its own, so the note's is the one the comment adds
    const seeded = new Set(await commentStores(a.vaultDir));
    await a.api.comments.add({ id: "c1", path: OLD, text: "Still true?" });
    const stores = await commentStores(a.vaultDir);
    const added = stores.filter((name) => !seeded.has(name));
    expectEq(added.length, 1, "the comment stores A's comment added");
    const store = `${COMMENTS_DIR}/${added[0] ?? ""}`;
    await syncUntil(a.api, "A after its notes", "clean");

    ctx.log("the phone signs in and mirrors the vault");
    const phone = await phoneRuntime(
      worker.origin,
      path.join(ctx.scratchDir, "phone"),
      await loginDevice(worker.origin, PHONE_NAME),
      { online: true },
    );
    await phone.start();
    await untilMirrored(phone, [PLAN, HUB, OLD, store]);

    ctx.log("the phone creates, renames, deletes and adds a photo");
    const created = await phone.fileOps.create("");
    expect(
      created.kind === "created" && created.path === "Untitled.md",
      `the phone's new note: ${JSON.stringify(created)}`,
    );
    const renamed = await phone.fileOps.rename(PLAN, "Roadmap");
    expect(
      renamed.kind === "renamed" &&
        renamed.path === "notes/Roadmap.md" &&
        renamed.unlinked.length === 0,
      `the phone's rename: ${JSON.stringify(renamed)}`,
    );
    await phone.fileOps.remove(OLD);
    const photo = photoBytes();
    const written = await phone.fileOps.writeAsset(PHOTO_NAME, photo);
    expect(
      written.kind === "written" && written.path === `assets/${PHOTO_NAME}`,
      `the phone's photo: ${JSON.stringify(written)}`,
    );
    await phone.notes.drain();
    const { parked, unsent } = phone.notes.outbox.status.get();
    expectEq(unsent, 0, "the phone's unsent changes");
    expectEq(parked.length, 0, "the phone's parked changes");

    ctx.log("A syncs and holds every one of them");
    await syncUntil(a.api, "A pulling the phone's changes", "clean");
    const onA = (file: string): string => path.join(a.vaultDir, file);
    expectEq(await readFile(onA("Untitled.md"), "utf-8"), "", "the new note on A");
    expectEq(
      await readFile(onA(HUB), "utf-8"),
      "See [[Roadmap]] for the details.\n",
      "the rewritten link on A",
    );
    expectEq(
      await readFile(onA("notes/Roadmap.md"), "utf-8"),
      "---\naliases:\n  - plan\n---\n# Plan\n",
      "the renamed note, its old name kept as an alias, on A",
    );
    expect(!(await exists(onA(PLAN))), "the old name is gone from A");
    expect(!(await exists(onA(OLD))), "the deleted note is gone from A");
    expect(!(await exists(onA(store))), "the deleted note's comment store is gone from A");
    const kept = await commentStores(a.vaultDir);
    expectEq(kept.toSorted(), [...seeded].toSorted(), "the other notes' comment stores on A");
    expect(
      Buffer.from(await readFile(onA(`assets/${PHOTO_NAME}`))).equals(Buffer.from(photo)),
      "the photo's bytes on A",
    );
    await exec("git", ["-C", a.vaultDir, "fsck", "--strict"], { env: hermeticProcessEnv() });
  },
};
