// Bundle orchestration: setup, integrations + skills listings. The bundle
// list itself lives in agent/bundles.ts. Auth lives in agent/auth.ts, the
// Agent wrapper in agent/agent.ts, shared paths in agent/paths.ts. Lifecycle
// composition (seed/teardown wiring, host-singleton resets, port + resource
// injection) lives host-side in lib/agent-lifecycle.ts — agent/ imports
// nothing from the rest of the host.

import fs from "node:fs";
import path from "node:path";

import { listSkills as listSkillsFromDisk } from "@repo/features/server/pi/skills";
import { prependPath, seedDirectory, seedFile } from "@repo/features/server/agent-runtime/seed";
import { readCliVersion } from "@repo/features/server/agent-runtime/install";

import { EXTENSION_BUNDLES } from "./bundles";
import {
  resolveBundleCli,
  runBundleSetups,
  type AgentPorts,
  type ExtensionCliInfo,
  type ExtensionRegisterContext,
  type ExtensionSetupContext,
} from "./extension";
import { AGENT_DIR, BIN_DIR, EXTENSIONS_DIR, WORKSPACE_DIR } from "./paths";
import type { IntegrationInfo, SetupProgress, SkillInfo } from "@repo/features/ipc";

/** Where the app's bundled agent assets (skills/, AGENTS.md) live, resolved
 * by the shell (HostPlatform) and injected by lib/agent-lifecycle.ts.
 * `strict` = a missing dir is fatal (packaged install is corrupt) rather
 * than a dev-checkout warn-and-continue. */
export type BundledResources = {
  dir: string;
  strict: boolean;
};

function buildSetupContext(
  ports: AgentPorts,
  resources: BundledResources,
  onProgress: (p: SetupProgress) => void,
  force = false,
): ExtensionSetupContext {
  return {
    binDir: BIN_DIR,
    ports,
    bundledResourcesDir: resources.dir,
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
  resources: BundledResources,
  onProgress: (p: SetupProgress) => void,
): Promise<void> {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  prependPath(BIN_DIR);

  const ctx = buildSetupContext(ports, resources, onProgress);
  if (!fs.existsSync(ctx.bundledResourcesDir)) {
    // In strict (packaged) installs the resources dir is laid down by the
    // packager; missing it means the install is corrupt and setup must fail
    // loudly. In dev the dir can be absent on a fresh checkout — warn but
    // continue so bundle setups still run.
    const msg = `Bundled resources not found at ${ctx.bundledResourcesDir}`;
    if (resources.strict) throw new Error(msg);
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
  resources: BundledResources,
  onProgress: (p: SetupProgress) => void,
): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await runBundleSetups(EXTENSION_BUNDLES, buildSetupContext(ports, resources, onProgress, true));
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
