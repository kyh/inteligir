// The harness table (issue #588): every per-harness fact the ACP runtime and
// the detection surface need, as DATA. A third harness is a row here — the
// runtime itself knows only ACP.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type HarnessId = "claude" | "codex";

export interface HarnessCredentialProbe {
  /** Home-relative file whose presence means "logged in" on every platform. */
  kind: "home-file";
  relativePath: string;
}

export interface HarnessKeychainProbe {
  /** macOS keychain generic-password service name (darwin only). */
  kind: "macos-keychain";
  service: string;
}

export interface HarnessDefinition {
  id: HarnessId;
  displayName: string;
  /** The vendor CLI the USER installs and logs into; probed on PATH. */
  vendorBinary: string;
  /** The login command Settings shows verbatim. */
  loginCommand: string;
  /** The ACP adapter's entry script, resolved from this package's own
   * dependencies — adapters ship WITH the app, so there is nothing to
   * install at runtime and the version verified in CI is the one that runs. */
  adapterEntry: string;
  /** Extra argv after the entry script. */
  adapterArgs: readonly string[];
  /** Where a login leaves its credential; any hit reads as signed-in. */
  credentialProbes: readonly (HarnessCredentialProbe | HarnessKeychainProbe)[];
  /** Whether the adapter is expected to honor `session/load` (verified per
   * adapter source); when false the runtime resumes by starting fresh. */
  supportsLoadSession: boolean;
  /** Route a model override into the child: each harness spells it its own
   * way (claude via the SDK's env var, codex via a config override arg). */
  applyModel: (model: string, env: Record<string, string>, args: string[]) => void;
  /** Env vars STRIPPED from the child. The claude SDK refuses to run when it
   * believes it is nested inside another claude session; this app spawning a
   * harness IS a legitimate top level, so the nesting sentinel must not leak
   * through from whatever launched the app itself. */
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
