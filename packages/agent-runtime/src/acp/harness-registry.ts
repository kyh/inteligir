import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

const require = createRequire(import.meta.url);

// claude first: every list of harnesses reads in this order.
export const HARNESS_IDS = ["claude", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];
export const harnessIdSchema = z.enum(HARNESS_IDS);

// a model id is vendor-specific, so each harness carries its own; null runs the vendor's default.
export type HarnessModels = Readonly<Record<HarnessId, string | null>>;

// what the vendor itself says of the sign-in in its shared store; unknown is a vendor that did not
// say, never a guess either way.
export type VendorAccount =
  | { state: "signed-in"; label: string; email: string | null }
  | { state: "signed-out" }
  | { state: "unknown"; detail: string };

// one finished run of a vendor binary.
export interface VendorExit {
  code: number;
  stdout: string;
  stderr: string;
}

interface AccountProbe {
  args: readonly string[];
  read: (exit: VendorExit) => VendorAccount;
}

// the claude SDK's filesystem setting tiers.
type ClaudeSettingSource = "user" | "project" | "local";

interface HarnessSessionMeta {
  claudeCode: { options: { settingSources: readonly ClaudeSettingSource[] } };
}

export interface HarnessDefinition {
  id: HarnessId;
  displayName: string;
  adapterEntry: string;
  // set on the adapter's env unless the host's env already names it
  adapterEnv: Readonly<Record<string, string>>;
  // the vendor binary the adapter runs: the host's override when it names one, else the one bundled
  // beside the adapter, never PATH's. null is an override naming nothing, or a bundle without it.
  vendorExecutable: (env: NodeJS.ProcessEnv) => string | null;
  accountProbe: AccountProbe;
  applyModel: (model: string, env: Record<string, string>) => void;
  // the claude SDK refuses to run when it believes it is nested inside another claude session, so
  // the nesting sentinel must not leak through from whatever launched this app.
  envOmit: readonly string[];
  // every session/new and session/load carries it as `_meta`, the adapter's channel for vendor
  // options; null sends none.
  sessionMeta: HarnessSessionMeta | null;
  // vault entries the vendor would load as its own configuration when no session option can stop
  // it; a session never opens on a vault that holds one.
  refusedVaultEntries: readonly string[];
}

const resolveAdapterEntry = (specifier: string): string => require.resolve(specifier);

const CLAUDE_ADAPTER_ENTRY = resolveAdapterEntry(
  "@agentclientprotocol/claude-agent-acp/dist/index.js",
);
const CODEX_ADAPTER_ENTRY = resolveAdapterEntry("@agentclientprotocol/codex-acp/dist/index.js");

const glibcReportSchema = z.object({ header: z.object({ glibcVersionRuntime: z.string() }) });

// claude-agent-acp's own claudeCliPath picks the SDK's platform package this way: linux may carry
// both libc builds side by side, and the wrong one segfaults rather than failing to spawn.
const claudePlatformPackages = (): string[] => {
  const { arch, platform } = process;
  if (platform !== "linux") {
    const extension = platform === "win32" ? ".exe" : "";
    return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${extension}`];
  }
  const glibc = `@anthropic-ai/claude-agent-sdk-linux-${arch}/claude`;
  const musl = `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude`;
  return glibcReportSchema.safeParse(process.report.getReport()).success
    ? [glibc, musl]
    : [musl, glibc];
};

// resolved through the adapter's own SDK, so it is the binary the adapter would start.
const resolveClaudeBinary = (): string | null => {
  let fromSdk: NodeJS.Require;
  try {
    fromSdk = createRequire(
      createRequire(CLAUDE_ADAPTER_ENTRY).resolve("@anthropic-ai/claude-agent-sdk"),
    );
  } catch {
    return null;
  }
  for (const candidate of claudePlatformPackages()) {
    try {
      return fromSdk.resolve(candidate);
    } catch {
      continue;
    }
  }
  return null;
};

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

const BUNDLED_CLAUDE = resolveClaudeBinary();
const BUNDLED_CODEX = resolveCodexBinary();

// an override the adapter would honour wins, and one naming nothing is not swapped for the
// bundle: that would report a runtime the adapter is not going to run.
const overriddenOrBundled = (
  override: string | undefined,
  bundled: string | null,
): string | null => {
  const chosen = override === undefined || override === "" ? bundled : override;
  return chosen !== null && existsSync(chosen) ? chosen : null;
};

// the fields of `claude auth status --json` a verdict reads. signed out, it exits 1 printing the
// same JSON, so the exit code is not the verdict.
const claudeAuthStatusSchema = z.object({
  apiKeySource: z.string().optional(),
  apiProvider: z.string().optional(),
  email: z.string().optional(),
  loggedIn: z.boolean(),
  subscriptionType: z.string().optional(),
});
type ClaudeAuthStatus = z.infer<typeof claudeAuthStatusSchema>;

const parseClaudeAuthStatus = (stdout: string): ClaudeAuthStatus | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const status = claudeAuthStatusSchema.safeParse(parsed);
  return status.success ? status.data : null;
};

// "max" reads "Claude Max", the plan's own name, titled as claude-agent-acp titles it.
const claudePlanLabel = (plan: string): string => {
  const titled = plan.replaceAll(/\S+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1));
  return /^claude(?:\s|$)/iu.test(plan) ? titled : `Claude ${titled}`;
};

const readClaudeAccount = ({ stdout }: VendorExit): VendorAccount => {
  const status = parseClaudeAuthStatus(stdout);
  if (status === null) {
    return {
      detail: "claude auth status answered in a shape this app cannot read",
      state: "unknown",
    };
  }
  const { apiKeySource, apiProvider, email, loggedIn, subscriptionType } = status;
  // loggedIn tracks the claude.ai login alone: an API key or a cloud backend pays with it false.
  const cloudBackend = apiProvider !== undefined && apiProvider !== "firstParty";
  if (!loggedIn && apiKeySource === undefined && !cloudBackend) {
    return { state: "signed-out" };
  }
  if (apiKeySource !== undefined) {
    return { email: null, label: "Anthropic API key", state: "signed-in" };
  }
  return {
    email: email ?? null,
    label: subscriptionType === undefined ? "Claude" : claudePlanLabel(subscriptionType),
    state: "signed-in",
  };
};

// `codex login status` answers on stderr: exit 0 is signed in, and exit 1 is either signed out or
// unable to tell, which only the text separates.
const CODEX_SIGNED_OUT = /^Not logged in$/mu;
// an API key's line carries the key's redacted tail after " - ", which is no label.
const CODEX_LOGIN_METHOD = /^Logged in using (?:an? )?(?<method>.+?)(?: - .*)?$/mu;

const readCodexAccount = ({ code, stderr, stdout }: VendorExit): VendorAccount => {
  const said = `${stdout}\n${stderr}`;
  if (code === 0) {
    const method = CODEX_LOGIN_METHOD.exec(said)?.groups?.method ?? "ChatGPT";
    return {
      email: null,
      label: method.charAt(0).toUpperCase() + method.slice(1),
      state: "signed-in",
    };
  }
  if (CODEX_SIGNED_OUT.test(said)) {
    return { state: "signed-out" };
  }
  const [firstLine = ""] = said.trim().split("\n");
  return {
    detail: firstLine === "" ? `codex login status exited ${String(code)}` : firstLine,
    state: "unknown",
  };
};

const codexAdapterEnv = (): Record<string, string> =>
  BUNDLED_CODEX === null ? {} : { CODEX_PATH: BUNDLED_CODEX };

export const HARNESSES = {
  claude: {
    accountProbe: { args: ["auth", "status", "--json"], read: readClaudeAccount },
    adapterEntry: CLAUDE_ADAPTER_ENTRY,
    // the adapter spawns the SDK's native claude binary, never a node script.
    adapterEnv: {},
    applyModel: (model: string, env: Record<string, string>) => {
      env.ANTHROPIC_MODEL = model;
    },
    displayName: "Claude",
    envOmit: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
    id: "claude",
    // the vault is synced content: the `project` and `local` sources would load its .claude
    // settings and .mcp.json and run what they name on this host. CLAUDE.md and the vault-keyed
    // MCP servers in ~/.claude.json share those two gates, so they go too.
    sessionMeta: { claudeCode: { options: { settingSources: ["user"] } } },
    refusedVaultEntries: [],
    vendorExecutable: (env: NodeJS.ProcessEnv) =>
      overriddenOrBundled(env.CLAUDE_CODE_EXECUTABLE, BUNDLED_CLAUDE),
  },
  codex: {
    accountProbe: { args: ["login", "status"], read: readCodexAccount },
    adapterEntry: CODEX_ADAPTER_ENTRY,
    adapterEnv: codexAdapterEnv(),
    // the adapter reads no argv; CODEX_CONFIG is merged over every session's codex config.
    applyModel: (model: string, env: Record<string, string>) => {
      env.CODEX_CONFIG = JSON.stringify({ model });
    },
    displayName: "ChatGPT",
    envOmit: [],
    id: "codex",
    // codex-acp takes no per-session option: the adapter patch pnpm-workspace.yaml names marks the
    // vault untrusted.
    sessionMeta: null,
    // npm applies no pnpm patch, so an npm-installed CLI runs an adapter that trusts the vault and
    // loads its .codex config; the refusal holds whichever adapter is installed.
    refusedVaultEntries: [".codex"],
    vendorExecutable: (env: NodeJS.ProcessEnv) =>
      overriddenOrBundled(env.CODEX_PATH, BUNDLED_CODEX),
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

// a vault holding the vendor's own configuration would configure the agent from synced content.
export class VaultConfigRefusedError extends Error {
  constructor(harness: HarnessDefinition, entry: string) {
    super(
      `This vault holds a ${entry} folder, which ${harness.displayName} would load as its own settings. Remove it from the vault to ask ${harness.displayName} here.`,
    );
    this.name = "VaultConfigRefusedError";
  }
}
