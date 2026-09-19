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

const resolveAdapterEntry = (specifier: string): string => require.resolve(specifier);

export const HARNESSES = {
  claude: {
    adapterArgs: [],
    adapterEntry: resolveAdapterEntry("@zed-industries/claude-code-acp/dist/index.js"),
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
    supportsLoadSession: true,
    vendorBinary: "claude",
  },
  codex: {
    adapterArgs: [],
    adapterEntry: resolveAdapterEntry("@zed-industries/codex-acp/bin/codex-acp.js"),
    applyModel: (model: string, _env: Record<string, string>, args: string[]) => {
      args.push("-c", `model=${JSON.stringify(model)}`);
    },
    credentialProbes: [{ kind: "home-file", relativePath: ".codex/auth.json" }],
    displayName: "Codex",
    envOmit: [],
    id: "codex",
    loginCommand: "codex login",
    supportsLoadSession: true,
    vendorBinary: "codex",
  },
} satisfies Record<HarnessId, HarnessDefinition>;

export const HARNESS_IDS: readonly HarnessId[] = ["claude", "codex"];

export const isHarnessId = (value: string): value is HarnessId => value in HARNESSES;

export const requireHarness = (providerId: string): HarnessDefinition => {
  if (!isHarnessId(providerId)) {
    throw new Error(
      `Unknown provider "${providerId}". Available providers: ${HARNESS_IDS.join(", ")}`,
    );
  }
  return HARNESSES[providerId];
};
