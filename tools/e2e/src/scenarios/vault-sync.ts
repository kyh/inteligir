// Two instances against one scratch bare remote: a write on A reaches B's
// disk through git sync, and a both-edited-the-same-line pair surfaces as the
// typed conflict state on the instance whose rebase was refused. Auto-sync
// (the boot pass and the interval) is disabled on both instances via
// INTELIGIR_SYNC_INTERVAL_MS=0, so every sync below is an explicit call and
// the divergence between A and B is deterministic.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { InstanceApi } from "../harness/instance";
import type { Scenario } from "../harness/scenario";

const SHARED_CONTENT = "# Shared\n\nWritten on A, synced to B.\n";
const CONFLICT_BASE = "# Conflict\n\nshared line\n";
const CONFLICT_A = "# Conflict\n\nedited on A\n";
const CONFLICT_B = "# Conflict\n\nedited on B\n";

const NO_AUTO_SYNC = { INTELIGIR_SYNC_INTERVAL_MS: "0" };

async function syncExpectClean(api: InstanceApi, label: string): Promise<void> {
  const status = await api.vault.syncNow();
  expect(
    status.state === "clean",
    `${label}: expected a clean sync, got "${status.state}" (lastError: ${status.lastError ?? "none"})`,
  );
}

export const vaultSync: Scenario = {
  name: "vault-sync",
  description: "two instances, one bare remote: propagation, then a typed conflict",
  async run(ctx) {
    const remote = await ctx.bareRemote();
    const a = await ctx.boot({ name: "a", vaultRemote: remote, extraEnv: NO_AUTO_SYNC });

    ctx.log("A writes notes/shared.md and syncs");
    await a.api.vault.write({ path: "notes/shared.md", content: SHARED_CONTENT });
    await syncExpectClean(a.api, "A after write");

    const b = await ctx.boot({ name: "b", vaultRemote: remote, extraEnv: NO_AUTO_SYNC });
    ctx.log("B syncs and receives the file");
    await syncExpectClean(b.api, "B first sync");

    const readB = await b.api.vault.read({ path: "notes/shared.md" });
    expectEq(readB.content, SHARED_CONTENT, "B's wire content");
    expectEq(
      await readFile(join(b.vaultDir, "notes", "shared.md"), "utf8"),
      SHARED_CONTENT,
      "B's on-disk content",
    );

    ctx.log("seeding the conflict base on both sides");
    await a.api.vault.write({ path: "conflict.md", content: CONFLICT_BASE });
    await syncExpectClean(a.api, "A after base");
    await syncExpectClean(b.api, "B after base");
    expectEq(
      await readFile(join(b.vaultDir, "conflict.md"), "utf8"),
      CONFLICT_BASE,
      "B holds the conflict base",
    );

    ctx.log("A edits the shared line and syncs; B edits it differently");
    await a.api.vault.write({ path: "conflict.md", content: CONFLICT_A });
    await syncExpectClean(a.api, "A after edit");

    await b.api.vault.write({ path: "conflict.md", content: CONFLICT_B });

    ctx.log("B syncs into the conflict");
    const conflicted = await b.api.vault.syncNow();
    expect(
      conflicted.state === "conflict",
      `B's sync should surface the conflict, got "${conflicted.state}" (lastError: ${conflicted.lastError ?? "none"})`,
    );
    expect(
      conflicted.conflict.files.includes("conflict.md"),
      `conflict names the file (got ${JSON.stringify(conflicted.conflict.files)})`,
    );
    expect(conflicted.conflict.ours.commits >= 1, "at least one local commit in the conflict");
    expect(conflicted.conflict.theirs.commits >= 1, "at least one remote commit in the conflict");

    ctx.log("the refused rebase was aborted: B keeps its own edit, and status stays conflict");
    expectEq(
      await readFile(join(b.vaultDir, "conflict.md"), "utf8"),
      CONFLICT_B,
      "B's working tree after the abort",
    );
    const statusB = await b.api.vault.status();
    expect(statusB.state === "conflict", `B status settled on "${statusB.state}"`);

    ctx.log("B's repo is intact under git's own eyes");
    // B's edit was committed before the fetch, so a fully aborted rebase
    // leaves the tree byte-identical to HEAD: porcelain must be EMPTY.
    const porcelain = await exec(
      "git",
      ["-C", b.vaultDir, "--no-optional-locks", "status", "--porcelain"],
      { env: hermeticProcessEnv() },
    );
    expectEq(porcelain.stdout.trim(), "", "B's porcelain status after the abort");
    expect(
      !existsSync(join(b.vaultDir, ".git", "rebase-merge")),
      "no rebase-merge state left behind",
    );
    expect(
      !existsSync(join(b.vaultDir, ".git", "rebase-apply")),
      "no rebase-apply state left behind",
    );

    ctx.log("A is untouched by B's conflict");
    const readA = await a.api.vault.read({ path: "conflict.md" });
    expectEq(readA.content, CONFLICT_A, "A keeps its own edit");
  },
};
