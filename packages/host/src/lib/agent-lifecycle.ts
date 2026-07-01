// ---------------------------------------------------------------------------
// Agent lifecycle composition — the host-side seam between the kernel and
// agent/. The host composes, agent receives: this module builds the ports
// agent extensions act through (executor) plus the injected bundled-resource
// location, and owns the seed/login/teardown orchestration that touches host
// singletons. agent/* must never import the rest of the host — anything an
// extension needs flows through here.
// ---------------------------------------------------------------------------

import fs from "node:fs";

import { login, resetAuthStorage } from "../agent/auth";
import type { AgentPorts } from "../agent/extension";
import { AGENT_DIR } from "../agent/paths";
import { seedResources, type BundledResources } from "../agent/setup";
import { getPlatform } from "../platform-instance";
import { reassertHostLock } from "./host-lock";
import { resetDelegationManager } from "../delegation/delegation-manager";
import { executeEnsuringDaemon, resumeEnsuringDaemon } from "../executor/executor-client";
import {
  EXECUTOR_CLI,
  getExecutorDaemon,
  installExecutor,
  resetExecutorDaemon,
} from "../executor/executor-daemon";
import { resetNotifications } from "../notifications";
import { resetSecretStore } from "../secrets";
import { resetUiState } from "../ui-state";
import {
  getVaultManager,
  resetVaultManager,
  resumeVaultWrites,
  suspendVaultWrites,
} from "../vault/vault";
import type { SetupProgress } from "@repo/core/ipc";

/** Bundled agent assets (skills/, AGENTS.md), resolved by the shell. */
export function getBundledResources(): BundledResources {
  const platform = getPlatform();
  return { dir: platform.resourcesDir, strict: platform.strictResources };
}

/** Build the host-owned capability ports handed to agent extension bundles.
 * Stateless — every function defers to the live singleton, so a port built
 * before a logout/login cycle stays valid after it. */
export function getAgentPorts(): AgentPorts {
  return {
    executor: {
      cli: EXECUTOR_CLI,
      install: (force) => installExecutor(force),
      start: async () => (await getExecutorDaemon().start()) !== null,
      // The *EnsuringDaemon variants attempt one daemon (re)start before each
      // call, so a mid-session daemon crash doesn't permanently break the
      // agent's execute tool.
      execute: executeEnsuringDaemon,
      resume: resumeEnsuringDaemon,
    },
  };
}

/** Seed agent resources (dirs, bundled skills/AGENTS.md, bundle setups). */
export async function seedAgentResources(onProgress: (p: SetupProgress) => void): Promise<void> {
  // Eager-start the executor daemon: spawning + reading the "ready on …"
  // banner is the longest single setup step (~10–20s warm), and it doesn't
  // depend on bundle setups or the agent factory. The start is gated on
  // installExecutor() so a first boot doesn't spawn before the binary
  // download finishes (installExecutor shares its in-flight promise with the
  // executor bundle's setup(), so this adds no second download; on warm
  // boots it resolves after a version check). Only the spawn waits on the
  // install — seedResources below still runs concurrently. start() caches
  // its in-flight promise, so the later executor extension register() (which
  // already calls start() before returning its tools) just awaits the same
  // promise — the daemon spawn overlaps with bundle CLI version checks
  // instead of stacking after them.
  void installExecutor()
    .then(() => getExecutorDaemon().start())
    .catch((err: unknown) => {
      // Swallow here; the executor extension register() awaits start() too
      // and will surface a real failure with the right error path.
      console.warn("[agent] executor eager start failed (continuing):", err);
    });

  await seedResources(getAgentPorts(), getBundledResources(), onProgress);

  // Now that the workspace exists, (re)create the vault folder and the agent's
  // `./vault` symlink into it so the agent's native file tools can find it.
  getVaultManager().ensureReady();
}

/** Run the provider OAuth flow, then lift the vault write suspension that a
 * previous logout put in place — after successful re-auth the workspace may
 * materialize again on the next write. */
export async function loginAgent(): Promise<void> {
  await login();
  resumeVaultWrites();
}

export function teardownAgentResources(): void {
  // Drop singletons that hold JsonStore caches BEFORE removing the directory,
  // so an in-flight debounced write can't resurrect a store file from a warm
  // in-memory cache after the rm.
  resetAuthStorage();
  resetNotifications();
  resetDelegationManager();
  resetExecutorDaemon();
  resetUiState();
  resetSecretStore();
  // Suspend vault writes BEFORE wiping ~/.inteligir, so a late autosave from a
  // still-mounted panel can't rebuild a fresh manager at the default root and
  // write the user's edits there (or recreate app data).
  suspendVaultWrites();
  resetVaultManager();
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  // The rm just deleted our own host.lock — re-assert it so another host
  // can't boot beside us between logout and the next login.
  reassertHostLock();
}
