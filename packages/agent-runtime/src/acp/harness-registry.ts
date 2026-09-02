import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type HarnessId = "claude" | "codex";

export interface HarnessCredentialProbe {
  kind: "home-file";
  relativePath: string;
}

export interface HarnessKeychainProbe {
  kind: "macos-keychain";
  service: string;
}

export interface HarnessDefinition {
  id: HarnessId;
  displayName: string;
  vendorBinary: string;
  loginCommand: string;
  adapterEntry: string;
  adapterArgs: readonly string[];
  credentialProbes: readonly (HarnessCredentialProbe | HarnessKeychainProbe)[];
  supportsLoadSession: boolean;
  applyModel: (model: string, env: Record<string, string>, args: string[]) => void;
  // the claude SDK refuses to run when it believes it is nested inside another claude session, so
  // the nesting sentinel must not leak through from whatever launched this app.
  envOmit: readonly string[];
}

function resolveAdapterEntry(specifier: string): string {
  return require.resolve(specifier);
}

export const HARNESSES = {
  claude: {
    id: "claude",
    displayName: "Claude Code",
    vendorBinary: "claude",
    loginCommand: "claude /login",
    adapterEntry: resolveAdapterEntry("@zed-industries/claude-code-acp/dist/index.js"),
    adapterArgs: [],
    credentialProbes: [
      { kind: "home-file", relativePath: ".claude/.credentials.json" },
      { kind: "macos-keychain", service: "Claude Code-credentials" },
    ],
    supportsLoadSession: true,
    applyModel: (model: string, env: Record<string, string>) => {
      env["ANTHROPIC_MODEL"] = model;
    },
    envOmit: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
  },
  codex: {
    id: "codex",
    displayName: "Codex",
    vendorBinary: "codex",
    loginCommand: "codex login",
    adapterEntry: resolveAdapterEntry("@zed-industries/codex-acp/bin/codex-acp.js"),
    adapterArgs: [],
    credentialProbes: [{ kind: "home-file", relativePath: ".codex/auth.json" }],
    supportsLoadSession: true,
    applyModel: (model: string, _env: Record<string, string>, args: string[]) => {
      args.push("-c", `model=${JSON.stringify(model)}`);
    },
    envOmit: [],
  },
} satisfies Record<HarnessId, HarnessDefinition>;

export const HARNESS_IDS: readonly HarnessId[] = ["claude", "codex"];

export function isHarnessId(value: string): value is HarnessId {
  return value in HARNESSES;
}

export function requireHarness(providerId: string): HarnessDefinition {
  if (!isHarnessId(providerId)) {
    throw new Error(
      `Unknown provider "${providerId}". Available providers: ${HARNESS_IDS.join(", ")}`,
    );
  }
  return HARNESSES[providerId];
}
