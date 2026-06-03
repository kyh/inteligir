// Bundle orchestration: discovery, setup, teardown, integrations + skills
// listings. Auth lives in agent/auth.ts, the Agent wrapper in agent/agent.ts,
// shared paths in agent/paths.ts.

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { listSkills as listSkillsFromDisk } from "@repo/pi-driver/skills";
import { prependPath, seedDirectory, seedFile } from "@repo/agent-runtime/seed";
import { readCliVersion } from "@repo/agent-runtime/install";

import { resetAuthStorage } from "@/agent/auth";
import {
  runBundleSetups,
  type ExtensionRegisterContext,
  type ExtensionSetupContext,
  type PiExtensionBundle,
} from "@/agent/extension";
import { AGENT_DIR, BIN_DIR, EXTENSIONS_DIR, WORKSPACE_DIR } from "@/agent/paths";
import { resetExecutorDaemon } from "@/main/executor/executor-daemon";
import { resetShellCache } from "@/main/shell";
import { resetNotifications } from "@/main/notifications";
import type { IntegrationInfo, SetupProgress, SkillInfo } from "@/shared/ipc";

// ---------------------------------------------------------------------------
// Extension bundles — auto-discovered from ./<name>/extension.ts default
// exports. Adding a new extension is "create one folder"; setup.ts never
// needs to be edited. Sorted by bundle name for deterministic registration
// order across builds.
// ---------------------------------------------------------------------------

const bundleModules = import.meta.glob<{ default: PiExtensionBundle }>("./*/extension.ts", {
  eager: true,
});

export const EXTENSION_BUNDLES: PiExtensionBundle[] = Object.values(bundleModules)
  .map((m) => m.default)
  .toSorted((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// Bundled resource discovery
// ---------------------------------------------------------------------------

declare const PROJECT_ROOT: string;

function getBundledResourcesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "resources", "agent");
  }
  return path.join(PROJECT_ROOT, "resources", "agent");
}

function buildSetupContext(
  onProgress: (p: SetupProgress) => void,
  force = false,
): ExtensionSetupContext {
  return { binDir: BIN_DIR, bundledResourcesDir: getBundledResourcesDir(), onProgress, force };
}

export function buildRegisterContext(): ExtensionRegisterContext {
  return { binDir: BIN_DIR };
}

// ---------------------------------------------------------------------------
// Lifecycle: setup / teardown
// ---------------------------------------------------------------------------

/**
 * Seed bundled skills + AGENTS.md into ~/.inteligir/ on first run, ensure the
 * bundled CLI bin dir is on PATH so agent tools can find it, and run each
 * extension bundle's setup() (binary install, OAuth seed, etc.).
 *
 * Non-critical bundle setup failures log and continue; a critical bundle's
 * failure throws and surfaces as SETUP_FAIL in the app state machine.
 */
export async function seedResources(onProgress: (p: SetupProgress) => void): Promise<void> {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  prependPath(BIN_DIR);

  const ctx = buildSetupContext(onProgress);
  if (!fs.existsSync(ctx.bundledResourcesDir)) {
    console.warn("[agent] bundled resources not found at", ctx.bundledResourcesDir);
    return;
  }

  seedDirectory(path.join(ctx.bundledResourcesDir, "skills"), path.join(AGENT_DIR, "skills"));
  seedFile(path.join(ctx.bundledResourcesDir, "AGENTS.md"), path.join(AGENT_DIR, "AGENTS.md"));

  await runBundleSetups(EXTENSION_BUNDLES, ctx);
}

export function isSetupComplete(): boolean {
  return fs.existsSync(WORKSPACE_DIR);
}

export function teardownResources(): void {
  // Drop singletons that hold JsonStore caches BEFORE removing the directory.
  // An in-flight debounced write (e.g. a WidgetViewer's unmount-time flush)
  // running between the rm and the cache reset would otherwise resurrect
  // runtime-ui.json from the warm in-memory shell. With this order, such a
  // write either races against the singleton reset (its write lands before
  // rm and gets wiped) or arrives after the cache is gone.
  resetAuthStorage();
  resetNotifications();
  resetShellCache();
  resetExecutorDaemon();
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Integrations (installed CLI binaries) — list + repair
// ---------------------------------------------------------------------------

/** Report installed-vs-pinned versions for every bundle that installs a CLI. */
export async function listIntegrations(): Promise<IntegrationInfo[]> {
  const clis = EXTENSION_BUNDLES.map((bundle) => bundle.cli).filter(
    (cli): cli is NonNullable<PiExtensionBundle["cli"]> => cli !== undefined,
  );
  return Promise.all(
    clis.map(async (cli) => ({
      name: cli.name,
      expected: cli.version,
      installed: await readCliVersion(cli.binPath),
    })),
  );
}

/**
 * Force-reinstall every CLI binary (repair). Re-runs each bundle's setup() with
 * force=true so up-to-date-but-corrupt binaries are re-downloaded. Reports
 * progress over the same channel as onboarding.
 */
export async function repairIntegrations(onProgress: (p: SetupProgress) => void): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await runBundleSetups(EXTENSION_BUNDLES, buildSetupContext(onProgress, true));
  onProgress({ step: "done", percent: null });
}

// ---------------------------------------------------------------------------
// Skills — read-only listing
// ---------------------------------------------------------------------------

/**
 * Skills available to the agent, read from disk via pi's own discovery so the
 * list is correct whether or not an agent session is currently running.
 */
export function listSkills(): SkillInfo[] {
  return listSkillsFromDisk({ cwd: WORKSPACE_DIR, agentDir: AGENT_DIR });
}
