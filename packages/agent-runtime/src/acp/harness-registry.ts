import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

const require = createRequire(import.meta.url);

// preference order: with no stored default, the first one on PATH is where a new thread starts.
export const HARNESS_IDS = ["claude", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];
export const harnessIdSchema = z.enum(HARNESS_IDS);

// a model id is vendor-specific, so each harness carries its own; null runs the vendor's default.
export type HarnessModels = Readonly<Record<HarnessId, string | null>>;

export interface HarnessCredentialProbe {
  kind: "home-file";
  relativePath: string;
}

export interface HarnessKeychainProbe {
  kind: "macos-keychain";
  service: string;
}

// the claude SDK's filesystem setting tiers.
type ClaudeSettingSource = "user" | "project" | "local";

interface HarnessSessionMeta {
  claudeCode: { options: { settingSources: readonly ClaudeSettingSource[] } };
}

export interface HarnessDefinition {
  id: HarnessId;
  displayName: string;
  vendorBinary: string;
  loginCommand: string;
  adapterEntry: string;
  // set on the adapter's env unless the host's env already names it
  adapterEnv: Readonly<Record<string, string>>;
  credentialProbes: readonly (HarnessCredentialProbe | HarnessKeychainProbe)[];
  applyModel: (model: string, env: Record<string, string>) => void;
  // the claude SDK refuses to run when it believes it is nested inside another claude session, so
  // the nesting sentinel must not leak through from whatever launched this app.
  envOmit: readonly string[];
  // every session/new and session/load carries it as `_meta`, the adapter's channel for vendor
  // options; null sends none.
  sessionMeta: HarnessSessionMeta | null;
}

const resolveAdapterEntry = (specifier: string): string => require.resolve(specifier);

const CODEX_ADAPTER_ENTRY = resolveAdapterEntry("@agentclientprotocol/codex-acp/dist/index.js");

// @openai/codex's own launcher (bin/codex.js) maps a platform onto its vendored binary this way.
const CODEX_TARGET_TRIPLES = new Map([
  ["darwin-arm64", "aarch64-apple-darwin"],
  ["darwin-x64", "x86_64-apple-darwin"],
  ["linux-arm64", "aarch64-unknown-linux-musl"],
  ["linux-x64", "x86_64-unknown-linux-musl"],
  ["win32-arm64", "aarch64-pc-windows-msvc"],
  ["win32-x64", "x86_64-pc-windows-msvc"],
]);

// codex-acp runs its bundled codex as `process.execPath codex.js`, which needs execPath to be a
// node binary; in the desktop shell the adapter's execPath is Electron's helper, which the
// runAsNode fuse keeps from running JavaScript. CODEX_PATH names the native binary that launcher
// would have spawned, so the adapter starts it directly. null leaves the launcher to find it.
const resolveCodexBinary = (): string | null => {
  const platform = `${process.platform}-${process.arch}`;
  const triple = CODEX_TARGET_TRIPLES.get(platform);
  if (triple === undefined) {
    return null;
  }
  try {
    const launcher = createRequire(CODEX_ADAPTER_ENTRY).resolve("@openai/codex/package.json");
    const vendored = createRequire(launcher).resolve(`@openai/codex-${platform}/package.json`);
    const binary = path.join(
      path.dirname(vendored),
      "vendor",
      triple,
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    return existsSync(binary) ? binary : null;
  } catch {
    return null;
  }
};

const codexAdapterEnv = (): Record<string, string> => {
  const binary = resolveCodexBinary();
  return binary === null ? {} : { CODEX_PATH: binary };
};

export const HARNESSES = {
  claude: {
    adapterEntry: resolveAdapterEntry("@agentclientprotocol/claude-agent-acp/dist/index.js"),
    // the adapter spawns the SDK's native claude binary, never a node script.
    adapterEnv: {},
    applyModel: (model: string, env: Record<string, string>) => {
      env.ANTHROPIC_MODEL = model;
    },
    credentialProbes: [
      { kind: "home-file", relativePath: ".claude/.credentials.json" },
      { kind: "macos-keychain", service: "Claude Code-credentials" },
    ],
    displayName: "Claude Code",
    envOmit: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
    id: "claude",
    loginCommand: "claude /login",
    // the vault is synced content: the `project` and `local` sources would load its .claude
    // settings and .mcp.json and run what they name on this host. CLAUDE.md and the vault-keyed
    // MCP servers in ~/.claude.json share those two gates, so they go too.
    sessionMeta: { claudeCode: { options: { settingSources: ["user"] } } },
    vendorBinary: "claude",
  },
  codex: {
    adapterEntry: CODEX_ADAPTER_ENTRY,
    adapterEnv: codexAdapterEnv(),
    // the adapter reads no argv; CODEX_CONFIG is merged over every session's codex config.
    applyModel: (model: string, env: Record<string, string>) => {
      env.CODEX_CONFIG = JSON.stringify({ model });
    },
    credentialProbes: [{ kind: "home-file", relativePath: ".codex/auth.json" }],
    displayName: "Codex",
    envOmit: [],
    id: "codex",
    loginCommand: "codex login",
    // codex-acp takes no per-session option: the adapter patch pnpm-workspace.yaml names marks the
    // vault untrusted.
    sessionMeta: null,
    vendorBinary: "codex",
  },
} satisfies Record<HarnessId, HarnessDefinition>;

// not `in HARNESSES`, which admits every Object.prototype key: "constructor" would be a harness.
export const isHarnessId = (value: string): value is HarnessId =>
  HARNESS_IDS.some((id) => id === value);

export const requireHarness = (providerId: string): HarnessDefinition => {
  if (!isHarnessId(providerId)) {
    throw new Error(
      `Unknown provider "${providerId}". Available providers: ${HARNESS_IDS.join(", ")}`,
    );
  }
  return HARNESSES[providerId];
};
