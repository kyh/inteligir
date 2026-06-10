// ---------------------------------------------------------------------------
// Agent lifecycle composition — the main-side seam between the kernel and
// agent/. main composes, agent receives: this module builds the ports agent
// extensions act through (shell, tasks, executor) and owns the seed/login/
// teardown orchestration that touches main singletons. agent/* must never
// import @/main/* — anything an extension needs from main flows through here.
// ---------------------------------------------------------------------------

import fs from "node:fs";

import { login, resetAuthStorage } from "@/agent/auth";
import type { AgentPorts } from "@/agent/extension";
import { AGENT_DIR } from "@/agent/paths";
import { seedResources } from "@/agent/setup";
import { resetDailyRefresh } from "@/main/daily-refresh";
import { executeEnsuringDaemon, resumeEnsuringDaemon } from "@/main/executor/executor-client";
import {
  EXECUTOR_CLI,
  getExecutorDaemon,
  installExecutor,
  resetExecutorDaemon,
} from "@/main/executor/executor-daemon";
import { deleteWithFlush, placeWithFlush, unplaceWithFlush } from "@/main/lib/shell-actions";
import { getWritableShell, resetShellCache, resumeShellWrites } from "@/main/shell";
import { resetNotifications } from "@/main/notifications";
import { resetSecretStore } from "@/main/secrets";
import { getTaskManager, resetTaskManager } from "@/main/tasks/task-manager";
import { resetUiState } from "@/main/ui-state";
import type { SetupProgress } from "@/shared/ipc";

/** Build the main-owned capability ports handed to agent extension bundles.
 * Stateless — every function defers to the live singleton, so a port built
 * before a logout/login cycle stays valid after it. */
export function getAgentPorts(): AgentPorts {
  return {
    shell: { getWritableShell, placeWithFlush, unplaceWithFlush, deleteWithFlush },
    tasks: {
      getTasks: () => getTaskManager().getTasks(),
      createTask: (params) => getTaskManager().createTask(params),
      toggleTask: (id) => getTaskManager().toggleTask(id),
      deleteTask: (id) => {
        getTaskManager().deleteTask(id);
      },
    },
    executor: {
      cli: EXECUTOR_CLI,
      install: (force) => installExecutor(force),
      start: async () => (await getExecutorDaemon().start()) !== null,
      // The *EnsuringDaemon variants attempt one daemon (re)start before each
      // call, so a mid-session daemon crash doesn't permanently break the
      // agent's execute tool (the widget path already restarts this way).
      execute: executeEnsuringDaemon,
      resume: resumeEnsuringDaemon,
    },
  };
}

/** Seed agent resources (dirs, bundled skills/AGENTS.md, bundle setups). */
export async function seedAgentResources(onProgress: (p: SetupProgress) => void): Promise<void> {
  // Eager-start the executor daemon: spawning + reading the "ready on …"
  // banner is the longest single setup step (~10–20s warm), and it doesn't
  // depend on bundle setups or the agent factory. start() caches its
  // in-flight promise, so the later executor extension register() (which
  // already calls start() before returning its tools) just awaits the same
  // promise — the daemon spawn overlaps with bundle CLI version checks
  // instead of stacking after them.
  void getExecutorDaemon()
    .start()
    .catch((err: unknown) => {
      // Swallow here; the executor extension register() awaits start() too
      // and will surface a real failure with the right error path.
      console.warn("[agent] executor eager start failed (continuing):", err);
    });

  await seedResources(getAgentPorts(), onProgress);
}

/** Run the provider OAuth flow, then lift the shell write suspension that a
 * previous logout's resetShellCache put in place — after successful re-auth
 * the workspace may materialize again on the next write. */
export async function loginAgent(): Promise<void> {
  await login();
  resumeShellWrites();
}

export function teardownAgentResources(): void {
  // Drop singletons that hold JsonStore caches BEFORE removing the directory.
  // An in-flight debounced write (e.g. a WidgetViewer's unmount-time flush)
  // running between the rm and the cache reset would otherwise resurrect
  // runtime-ui.json from the warm in-memory shell. With this order, such a
  // write either races against the singleton reset (its write lands before
  // rm and gets wiped) or arrives after the cache is gone.
  resetAuthStorage();
  resetNotifications();
  resetShellCache();
  resetTaskManager();
  resetDailyRefresh();
  resetExecutorDaemon();
  resetUiState();
  resetSecretStore();
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
}
