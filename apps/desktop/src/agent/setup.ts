// Bundle orchestration: discovery, setup, integrations + skills listings.
// Auth lives in agent/auth.ts, the Agent wrapper in agent/agent.ts, shared
// paths in agent/paths.ts. Lifecycle composition (seed/teardown wiring,
// main-singleton resets, port construction) lives main-side in
// main/lib/agent-lifecycle.ts — agent/ imports nothing from @/main.

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { listSkills as listSkillsFromDisk } from "@repo/pi-driver/skills";
import { prependPath, seedDirectory, seedFile } from "@repo/agent-runtime/seed";
import { readCliVersion } from "@repo/agent-runtime/install";

import {
  resolveBundleCli,
  runBundleSetups,
  type AgentPorts,
  type ExtensionCliInfo,
  type ExtensionRegisterContext,
  type ExtensionSetupContext,
  type PiExtensionBundle,
} from "@/agent/extension";
import { AGENT_DIR, BIN_DIR, EXTENSIONS_DIR, WORKSPACE_DIR } from "@/agent/paths";
import type { IntegrationInfo, SetupProgress, SkillInfo } from "@repo/core/ipc";

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
  ports: AgentPorts,
  onProgress: (p: SetupProgress) => void,
  force = false,
): ExtensionSetupContext {
  return {
    binDir: BIN_DIR,
    ports,
    bundledResourcesDir: getBundledResourcesDir(),
    onProgress,
    force,
  };
}

export function buildRegisterContext(ports: AgentPorts): ExtensionRegisterContext {
  return { binDir: BIN_DIR, ports };
}

// ---------------------------------------------------------------------------
// Lifecycle: setup
// ---------------------------------------------------------------------------

/**
 * Seed bundled skills + AGENTS.md into ~/.inteligir/ on first run, ensure the
 * bundled CLI bin dir is on PATH so agent tools can find it, and run each
 * extension bundle's setup() (binary install, OAuth seed, etc.).
 *
 * Non-critical bundle setup failures log and continue; a critical bundle's
 * failure throws and surfaces as SETUP_FAIL in the app state machine.
 */
export async function seedResources(
  ports: AgentPorts,
  onProgress: (p: SetupProgress) => void,
): Promise<void> {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  prependPath(BIN_DIR);

  const ctx = buildSetupContext(ports, onProgress);
  if (!fs.existsSync(ctx.bundledResourcesDir)) {
    // In packaged builds the resources/ dir is laid down by electron-builder;
    // missing it means the install is corrupt and setup must fail loudly.
    // In dev the path is derived from PROJECT_ROOT and can be absent on a
    // fresh checkout — warn but continue so bundle setups still run.
    const msg = `Bundled resources not found at ${ctx.bundledResourcesDir}`;
    if (app.isPackaged) throw new Error(msg);
    console.warn(`[agent] ${msg} — continuing without seed (dev only)`);
  } else {
    seedDirectory(path.join(ctx.bundledResourcesDir, "skills"), path.join(AGENT_DIR, "skills"));
    seedFile(path.join(ctx.bundledResourcesDir, "AGENTS.md"), path.join(AGENT_DIR, "AGENTS.md"));
  }

  await runBundleSetups(EXTENSION_BUNDLES, ctx);
}

export function isSetupComplete(): boolean {
  return fs.existsSync(WORKSPACE_DIR);
}

// ---------------------------------------------------------------------------
// Integrations (installed CLI binaries) — list + repair
// ---------------------------------------------------------------------------

/** Report installed-vs-pinned versions for every bundle that installs a CLI. */
export async function listIntegrations(ports: AgentPorts): Promise<IntegrationInfo[]> {
  const clis = EXTENSION_BUNDLES.map((bundle) => resolveBundleCli(bundle, ports)).filter(
    (cli): cli is ExtensionCliInfo => cli !== undefined,
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
export async function repairIntegrations(
  ports: AgentPorts,
  onProgress: (p: SetupProgress) => void,
): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await runBundleSetups(EXTENSION_BUNDLES, buildSetupContext(ports, onProgress, true));
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
