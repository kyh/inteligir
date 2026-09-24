import { createRequire } from "node:module";
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

export interface HarnessDefinition {
  id: HarnessId;
  displayName: string;
  vendorBinary: string;
  loginCommand: string;
  adapterEntry: string;
  credentialProbes: readonly (HarnessCredentialProbe | HarnessKeychainProbe)[];
  applyModel: (model: string, env: Record<string, string>) => void;
  // the claude SDK refuses to run when it believes it is nested inside another claude session, so
  // the nesting sentinel must not leak through from whatever launched this app.
  envOmit: readonly string[];
}

const resolveAdapterEntry = (specifier: string): string => require.resolve(specifier);

export const HARNESSES = {
  claude: {
    adapterEntry: resolveAdapterEntry("@agentclientprotocol/claude-agent-acp/dist/index.js"),
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
    vendorBinary: "claude",
  },
  codex: {
    adapterEntry: resolveAdapterEntry("@agentclientprotocol/codex-acp/dist/index.js"),
    // the adapter reads no argv; CODEX_CONFIG is merged over every session's codex config.
    applyModel: (model: string, env: Record<string, string>) => {
      env.CODEX_CONFIG = JSON.stringify({ model });
    },
    credentialProbes: [{ kind: "home-file", relativePath: ".codex/auth.json" }],
    displayName: "Codex",
    envOmit: [],
    id: "codex",
    loginCommand: "codex login",
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
