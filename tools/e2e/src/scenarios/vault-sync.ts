import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { InstanceApi } from "../harness/instance";
import type { Scenario } from "../harness/scenario";

const SHARED_CONTENT = "# Shared\n\nWritten on A, synced to B.\n";
const CONFLICT_BASE = "# Conflict\n\nshared line\n";
const CONFLICT_A = "# Conflict\n\nedited on A\n";
const CONFLICT_B = "# Conflict\n\nedited on B\n";

// every sync is an explicit call, so the divergence between A and B is deterministic.
const NO_AUTO_SYNC = { INTELIGIR_SYNC_INTERVAL_MS: "0" };

const syncExpectClean = async (api: InstanceApi, label: string) => {
  const status = await api.vault.syncNow();
  expect(
    status.state === "clean",
    `${label}: expected a clean sync, got "${status.state}" (lastError: ${status.lastError ?? "none"})`,
  );
  return status;
};

const gitIn = async (vaultDir: string, gitArgs: readonly string[]): Promise<string> => {
  const { stdout } = await exec("git", ["-C", vaultDir, ...gitArgs], {
    env: hermeticProcessEnv(),
  });
  return stdout.trim();
};

const expectNothingLeftBehind = async (vaultDir: string, label: string): Promise<void> => {
  expectEq(
    await gitIn(vaultDir, ["--no-optional-locks", "status", "--porcelain"]),
    "",
    `${label}'s porcelain status`,
  );
  for (const state of ["rebase-merge", "rebase-apply", "MERGE_HEAD"]) {
    expect(!existsSync(path.join(vaultDir, ".git", state)), `${label}: no ${state} left behind`);
  }
};

export const vaultSync: Scenario = {
  description: "two instances, one bare remote: propagation, then a merged same-line edit",
  name: "vault-sync",
  async run(ctx) {
    const remote = await ctx.bareRemote();
    const a = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "a", vaultRemote: remote });

    ctx.log("A writes notes/shared.md and syncs");
    await a.api.vault.write({
      content: SHARED_CONTENT,
      guard: { kind: "overwrite" },
      path: "notes/shared.md",
    });
    await syncExpectClean(a.api, "A after write");

    const b = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "b", vaultRemote: remote });
    ctx.log("B syncs and receives the file");
    await syncExpectClean(b.api, "B first sync");

    const readB = await b.api.vault.read({ path: "notes/shared.md" });
    expectEq(readB.content, SHARED_CONTENT, "B's wire content");
    expectEq(
      await readFile(path.join(b.vaultDir, "notes", "shared.md"), "utf-8"),
      SHARED_CONTENT,
      "B's on-disk content",
    );

    ctx.log("seeding the shared base on both sides");
    await a.api.vault.write({
      content: CONFLICT_BASE,
      guard: { kind: "overwrite" },
      path: "conflict.md",
    });
    await syncExpectClean(a.api, "A after base");
    await syncExpectClean(b.api, "B after base");
    expectEq(
      await readFile(path.join(b.vaultDir, "conflict.md"), "utf-8"),
      CONFLICT_BASE,
      "B holds the base",
    );

    ctx.log("A edits the shared line and syncs; B edits it differently");
    await a.api.vault.write({
      content: CONFLICT_A,
      guard: { kind: "overwrite" },
      path: "conflict.md",
    });
    await syncExpectClean(a.api, "A after edit");

    await b.api.vault.write({
      content: CONFLICT_B,
      guard: { kind: "overwrite" },
      path: "conflict.md",
    });

    ctx.log("B syncs: it keeps its own line, copies A's aside, and pushes");
    const merged = await syncExpectClean(b.api, "B meeting A's edit");
    const [report, ...more] = merged.conflicts;
    expect(
      report !== undefined && more.length === 0,
      `B reports one conflict (got ${JSON.stringify(merged.conflicts)})`,
    );
    expect(
      report.kind === "copied" && report.path === "conflict.md",
      `B's report copies conflict.md aside (got ${JSON.stringify(report)})`,
    );
    expectEq(report.keptDevice, merged.device, "the version that stayed is B's");
    const { copyPath } = report;
    expect(
      copyPath.startsWith("conflict (conflict, ") && copyPath.endsWith(").md"),
      `the copy is named beside its note (got ${copyPath})`,
    );
    expectEq(
      await readFile(path.join(b.vaultDir, "conflict.md"), "utf-8"),
      CONFLICT_B,
      "B keeps its own edit",
    );
    expectEq(
      await readFile(path.join(b.vaultDir, copyPath), "utf-8"),
      CONFLICT_A,
      "the copy holds A's version",
    );

    ctx.log("A pulls B's merge: the two converge byte for byte");
    const pulled = await syncExpectClean(a.api, "A pulling B's merge");
    expect(
      pulled.conflicts.some((copied) => copied.kind === "copied" && copied.copyPath === copyPath),
      `A reports the copy it pulled (got ${JSON.stringify(pulled.conflicts)})`,
    );
    for (const relPath of ["conflict.md", copyPath, "notes/shared.md"]) {
      expectEq(
        await readFile(path.join(a.vaultDir, relPath), "utf-8"),
        await readFile(path.join(b.vaultDir, relPath), "utf-8"),
        `A's and B's ${relPath}`,
      );
    }
    expectEq(
      await gitIn(a.vaultDir, ["rev-parse", "HEAD^{tree}"]),
      await gitIn(b.vaultDir, ["rev-parse", "HEAD^{tree}"]),
      "A's and B's trees",
    );

    ctx.log("neither repo is left mid-merge or mid-rebase");
    await expectNothingLeftBehind(a.vaultDir, "A");
    await expectNothingLeftBehind(b.vaultDir, "B");
  },
};
