import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { resolveCliBinDir, toShellEnv } from "inteligir/server/agent-shell-env";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { ExecResult } from "../harness/exec";
import type { AppInstance, InstanceApi } from "../harness/instance";
import type { Scenario, ScenarioContext } from "../harness/scenario";

const NOTE_PATH = "notes/chosen-remote.md";
const NOTE_CONTENT = "# Chosen remote\n\nWritten on A, pulled by B through a remote each chose.\n";

// every sync is an explicit call or the one a choice kicks, so what each instance holds is known.
const NO_AUTO_SYNC = { INTELIGIR_SYNC_INTERVAL_MS: "0" };

// loose: only the fields asserted on
const chosenStatusSchema = z.looseObject({
  remote: z.string(),
  remoteSource: z.literal("explicit"),
});

const syncExpectClean = async (api: InstanceApi, label: string): Promise<void> => {
  const status = await api.vault.syncNow();
  expect(
    status.state === "clean",
    `${label}: expected a clean sync, got "${status.state}" (lastError: ${status.lastError ?? "none"})`,
  );
};

const gitIn = async (vaultDir: string, gitArgs: readonly string[]): Promise<string> => {
  const { stdout } = await exec("git", ["-C", vaultDir, ...gitArgs], {
    env: hermeticProcessEnv(),
  });
  return stdout.trim();
};

const expectNoRemote = async (app: AppInstance, label: string): Promise<void> => {
  const status = await app.api.vault.status();
  expectEq(status.state, "no-remote", `${label}'s sync state`);
  expectEq(await gitIn(app.vaultDir, ["remote"]), "", `${label}'s \`git remote\``);
};

// the bare command through the PATH an agent's shell gets, pointed at one instance's data dir
const cliFor = (ctx: ScenarioContext, app: AppInstance) => {
  const cliBinDir = resolveCliBinDir(path.join(ctx.repoRoot, "apps", "cli", "bin"));
  expect(cliBinDir !== null, "the app resolves a CLI bin directory for the agent's PATH");
  const env = {
    ...hermeticProcessEnv(),
    ...toShellEnv(
      { cliBinDir, connectedDirs: [], dataDir: app.dataDir, skillsDir: null },
      hermeticProcessEnv(),
    ),
  };
  return async (...argv: string[]): Promise<ExecResult> =>
    await exec("inteligir", argv, { env, timeoutMs: 60_000 });
};

export const vaultRemoteSetting: Scenario = {
  description:
    "the one write to where a vault syncs: A picks a bare remote over the API, B through `inteligir vault remote` and pulls A's note, A goes back to the account signed out and stays remote-less across a restart, and a pinned instance refuses",
  name: "vault-remote-setting",
  async run(ctx) {
    const remote = await ctx.bareRemote();
    const a = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "a" });
    await expectNoRemote(a, "A before a choice");

    ctx.log("A writes a note and chooses the bare remote over the API");
    await a.api.vault.write({ content: NOTE_CONTENT, guard: { kind: "absent" }, path: NOTE_PATH });
    const chosen = await a.api.vault.setRemote({ kind: "remote", url: remote });
    expect(
      chosen.state !== "no-remote" && chosen.remoteSource === "explicit",
      `A's choice is the vault's own origin (got ${JSON.stringify(chosen)})`,
    );
    expectEq(await gitIn(a.vaultDir, ["remote", "get-url", "origin"]), remote, "A's origin");
    await syncExpectClean(a.api, "A on its chosen remote");

    ctx.log("B chooses the same remote with `inteligir vault remote` and pulls A's note");
    const b = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "b" });
    const cliB = cliFor(ctx, b);
    const setByCli = await cliB("vault", "remote", remote, "--json");
    const set = chosenStatusSchema.parse(JSON.parse(setByCli.stdout));
    expectEq(set.remote, remote, "B's choice, as the CLI answered it");
    await syncExpectClean(b.api, "B pulling A's note");
    expectEq(
      await readFile(path.join(b.vaultDir, NOTE_PATH), "utf-8"),
      NOTE_CONTENT,
      "B holds A's note on disk",
    );
    const printed = await cliB("vault", "remote");
    expectEq(printed.stdout, `${remote} (the vault's own git origin)\n`, "B's remote, printed");

    ctx.log("A goes back to the account while signed out: no remote, before and after a restart");
    const back = await a.api.vault.setRemote({ kind: "account" });
    expectEq(back.state, "no-remote", "A's state once back on the account");
    await expectNoRemote(a, "A back on the account");
    await a.stop();
    const restarted = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "a" });
    await expectNoRemote(restarted, "A after a restart");

    ctx.log("an instance INTELIGIR_VAULT_REMOTE pins refuses every choice");
    const pinned = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "pinned", vaultRemote: remote });
    const pinnedStatus = await pinned.api.vault.status();
    expect(
      pinnedStatus.state !== "no-remote" && pinnedStatus.remoteSource === "pinned",
      `the pinned instance reports its pin (got ${JSON.stringify(pinnedStatus)})`,
    );
    for (const choice of [{ kind: "account" }, { kind: "remote", url: remote }] as const) {
      const [refused] = await safe(pinned.api.vault.setRemote(choice));
      expect(
        isDefinedError(refused) && refused.code === "CONFLICT",
        `the pinned instance refuses ${choice.kind} as CONFLICT (got ${String(refused)})`,
      );
    }
  },
};
