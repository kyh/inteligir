// Bundle orchestration: setup, integrations + skills listings. The bundle
// list itself lives in agent/bundles.ts. Auth lives in agent/auth.ts, the
// Agent wrapper in agent/agent.ts, shared paths in agent/paths.ts. Lifecycle
// composition (seed/teardown wiring, host-singleton resets, port + resource
// injection) lives host-side in boot/agent-wiring.ts — agent/ imports
// nothing from the rest of the host.

import fs from "node:fs";
import path from "node:path";

import { listSkills as listSkillsFromDisk } from "@repo/agent/pi/skills";
import { prependPath, seedDirectory, seedFile } from "@repo/installer/seed";
import { readCliVersion } from "@repo/installer/install";

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
import { writeNewSkill, type NewSkill } from "./skill-authoring";
import type {
  IntegrationInfo,
  SetupProgress,
  SkillCreated,
  SkillInfo,
} from "@repo/bridge/ipc-registry";

/** Where the app's bundled agent assets (skills/, AGENTS.md) live, resolved
 * by the shell (HostPlatform) and injected by boot/agent-wiring.ts.
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
// Skills — listing + authoring
// ---------------------------------------------------------------------------

/** The folder a user's own skills live in — the same one seedResources()
 * seeds bundled skills into, so a listing row's source is decided by name
 * against the shipped set rather than by two competing paths. */
function userSkillsDir(): string {
  return path.join(AGENT_DIR, "skills");
}

/**
 * Skills available to the agent, read from disk via pi's own discovery so the
 * list is correct whether or not an agent session is currently running.
 */
export function listSkills(resources: BundledResources): SkillInfo[] {
  return listSkillsFromDisk({
    cwd: WORKSPACE_DIR,
    agentDir: AGENT_DIR,
    bundledSkillsDir: path.join(resources.dir, "skills"),
  });
}

/**
 * Write a new skill into `~/.inteligir/skills` and return it alongside the
 * refreshed listing. A running agent session loaded its skills at start, so
 * the new one reaches the model on the next start — which is what the Settings
 * copy tells the user.
 */
export function createSkill(resources: BundledResources, skill: NewSkill): SkillCreated {
  const dir = userSkillsDir();
  fs.mkdirSync(dir, { recursive: true });
  const { slug } = writeNewSkill(dir, skill);
  const skills = listSkills(resources);
  const created = skills.find((entry) => entry.name === slug);
  if (created === undefined) {
    throw new Error(`Skill "${slug}" was written but did not load — check its SKILL.md.`);
  }
  return { skill: created, skills };
}
