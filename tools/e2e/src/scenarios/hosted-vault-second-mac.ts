import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { exec, hermeticProcessEnv } from "../harness/exec";
import { hostedVaultEnv, syncUntil, untilIdentityKnown } from "../harness/hosted-vault";
import type { AppInstance } from "../harness/instance";
import type { Scenario } from "../harness/scenario";

const WELCOME = "Welcome.md";
const WELCOME_ON_A = "# Welcome\n\nRewritten on the first Mac.\n";
const ONLY_ON_A = "notes/field-notes.md";

const git = async (vaultDir: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await exec("git", ["-C", vaultDir, ...args], { env: hermeticProcessEnv() });
  return stdout.trim();
};

// git answers an unset key with a non-zero exit
const seedCommit = async (vaultDir: string): Promise<string | null> => {
  try {
    return await git(vaultDir, ["config", "--get", "inteligir.seedCommit"]);
  } catch {
    return null;
  }
};

const signIn = async (app: AppInstance, name: string, deviceName: string): Promise<void> => {
  const signedIn = await app.api.cloud.login({ ...OWNER, deviceName });
  expect(signedIn.state === "signed-in", `${name}'s login answered ${signedIn.state}`);
  await untilIdentityKnown(app.api, name);
};

export const hostedVaultSecondMac: Scenario = {
  description:
    "a second Mac's untouched starter vault takes the account's notes as they are when it signs in: no conflict copy, no starter kept over them",
  name: "hosted-vault-second-mac",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    // each boots accountless on a folder the boot creates, as a first run leaves it, so each holds
    // the starter notes before it signs in; the login itself kicks the first pass.
    const boot = async (name: string): Promise<AppInstance> =>
      await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name });

    ctx.log("creating the account; A signs in, rewrites Welcome.md, writes a note and syncs");
    await signUp(worker.origin);
    const a = await boot("a");
    await signIn(a, "A", "E2E Device A");
    const starter = await a.api.vault.read({ path: WELCOME });
    expect(starter.content !== WELCOME_ON_A, "A's Welcome.md starts as the starter note");
    await a.api.vault.write({ content: WELCOME_ON_A, guard: { kind: "overwrite" }, path: WELCOME });
    await a.api.vault.write({
      content: "# Field notes\n\nA quokka sighting.\n",
      guard: { kind: "overwrite" },
      path: ONLY_ON_A,
    });
    await syncUntil(a.api, "A after its edits", "clean");
    const aHead = await git(a.vaultDir, ["rev-parse", "HEAD"]);

    ctx.log("B boots on a fresh folder holding only its starter notes");
    const b = await boot("b");
    expectEq(
      await seedCommit(b.vaultDir),
      await git(b.vaultDir, ["rev-parse", "HEAD"]),
      "B's history before it signs in: the commit its boot seeded",
    );
    expectEq(
      await readFile(path.join(b.vaultDir, WELCOME), "utf-8"),
      starter.content,
      "B's starter Welcome.md",
    );

    ctx.log("B signs in to the same account and syncs");
    await signIn(b, "B", "E2E Device B");
    await syncUntil(b.api, "B's first sync", "clean");
    expectEq(await git(b.vaultDir, ["rev-parse", "HEAD"]), aHead, "B's HEAD");
    expectEq(
      await git(b.vaultDir, ["ls-tree", "-r", "HEAD"]),
      await git(a.vaultDir, ["ls-tree", "-r", "HEAD"]),
      "B's tree",
    );
    expectEq(
      await readFile(path.join(b.vaultDir, WELCOME), "utf-8"),
      WELCOME_ON_A,
      "B's Welcome.md on disk",
    );
    const tracked = await git(b.vaultDir, ["ls-files"]);
    expect(!tracked.includes("(conflict,"), `B holds no conflict copy (tracked: ${tracked})`);
    const status = await b.api.vault.status();
    expectEq(status.conflicts, [], "conflicts B reports");
    expectEq(await seedCommit(b.vaultDir), null, "B's seed record once it gave way");
    const hits = await b.api.knowledge.search({ q: "quokka" });
    expectEq(
      hits.results.map((hit) => hit.path),
      [ONLY_ON_A],
      "B's search for a note only A wrote",
    );

    ctx.log("A's next sync takes nothing");
    await syncUntil(a.api, "A after B joined", "clean");
    expectEq(await git(a.vaultDir, ["rev-parse", "HEAD"]), aHead, "A's HEAD after B joined");
  },
};
