// The process seam onto `codex mcp …` — the ONLY thing in this app that knows
// how codex stores MCP servers, and it deliberately knows nothing: it runs the
// CLI and reads its `--json`.
//
// THE CLI IS THE CONTRACT, `~/.codex/config.toml` IS ITS STORAGE. Editing the
// file directly would mean this repo owning codex's schema — today two
// transport tables, tomorrow whatever a codex release adds — and writing it
// would race the codex processes the agent runtime already spawns, which read
// and rewrite the same file. Nothing here opens it. The one thing the CLI
// cannot answer is asked of the CLI too: `list --json` carries `auth_status`,
// which `get --json` does not, so the listing is the richer read and there is
// no second call.
//
// NO SHELL, EVER. `execFile` with an argv list, so a command a user typed is
// one argv entry and a metacharacter in it is a character. That is also why
// `add` puts the command after `--`: everything past it is positional to
// codex's own parser, so a server named like a flag cannot become one.

import { execFile } from "node:child_process";
import type { Connector, ConnectorTransport } from "@repo/server-contract/connectors";
import { z } from "zod";
import { codexBinaryOnPath } from "../agent/agent-driver";

const CODEX_MCP_TIMEOUT_MS = 15_000;
const CODEX_MCP_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** A codex invocation that could not be completed, carrying what codex said
 *  about it — its refusals are the user's own tool talking, not an internal. */
export class CodexMcpError extends Error {}

/**
 * The two things this module needs from the world, injected so the service
 * above it is testable without codex installed: where the binary is, and what
 * running it prints.
 */
export interface CodexMcpRunner {
  /** The codex binary, or null when this machine has none. */
  binaryPath(): string | null;
  /** stdout of `codex <args>`; throws CodexMcpError on a non-zero exit. */
  run(binary: string, args: readonly string[]): Promise<string>;
}

function runCodex(binary: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: CODEX_MCP_MAX_BUFFER_BYTES,
        timeout: CODEX_MCP_TIMEOUT_MS,
        // The agent's own codex processes inherit this environment, so
        // CODEX_HOME (which moves the config file) resolves to the same file
        // the agent will read.
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const said = stderr.trim().length > 0 ? stderr.trim() : error.message;
          reject(new CodexMcpError(`codex ${args.join(" ")} failed: ${said}`));
          return;
        }
        resolve(stdout);
      },
    );
    // Nothing here reads stdin; closing it turns a prompt into an EOF rather
    // than a wait on the timeout.
    child.stdin?.end();
  });
}

/**
 * The real one. `binaryPath` is `codexBinaryOnPath` — the SAME resolution the
 * boot-time driver runs, so this section and the Agent section can never
 * disagree about whether codex is installed. It is asked per request rather
 * than once at boot, because a user who installs codex to fix the sentence
 * this section showed them should see it change without a restart.
 */
export const systemCodexMcpRunner: CodexMcpRunner = {
  binaryPath: () => codexBinaryOnPath(process.env),
  run: runCodex,
};

/**
 * Codex's own listing shape, parsed LENIENTLY on purpose: `z.object` strips
 * what it does not name, so a field a codex release adds is ignored rather
 * than fatal. Only the members this product renders are named.
 */
const codexStdioTransportSchema = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).nullish(),
});

const codexHttpTransportSchema = z.object({
  type: z.literal("streamable_http"),
  url: z.string(),
});

const codexUnknownTransportSchema = z.object({ type: z.string() });

const codexServerSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().nullish(),
  transport: z.union([
    codexStdioTransportSchema,
    codexHttpTransportSchema,
    codexUnknownTransportSchema,
  ]),
  auth_status: z.string().nullish(),
});

const codexListSchema = z.array(codexServerSchema);

function transportOf(parsed: z.infer<typeof codexServerSchema>["transport"]): ConnectorTransport {
  if (parsed.type === "stdio" && "command" in parsed) {
    return { kind: "stdio", command: parsed.command, args: parsed.args ?? [] };
  }
  if (parsed.type === "streamable_http" && "url" in parsed) {
    return { kind: "http", url: parsed.url };
  }
  return { kind: "other", summary: parsed.type };
}

/**
 * `codex mcp list --json` → this product's shape. A payload that does not
 * parse at all is a CodexMcpError rather than an empty list: "no connectors"
 * and "codex answered something I cannot read" are different sentences, and
 * the settings section says which.
 */
export function parseCodexMcpList(stdout: string): Connector[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch {
    throw new CodexMcpError("codex mcp list --json did not answer JSON");
  }
  const parsed = codexListSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new CodexMcpError("codex mcp list --json answered a shape this build cannot read");
  }
  return parsed.data.map((server) => ({
    name: server.name,
    // Absent reads as configured-and-on: codex omits the flag for a plain
    // server, and a listing that showed every one of them as disabled would
    // be a lie about what the agent can reach.
    enabled: server.enabled ?? true,
    transport: transportOf(server.transport),
    authStatus:
      server.auth_status === null || server.auth_status === undefined ? null : server.auth_status,
  }));
}

export const codexMcpArgs = {
  list: (): readonly string[] => ["mcp", "list", "--json"],
  /** `--` first, so a command that looks like a flag is still a command. */
  addStdio: (name: string, command: string, args: readonly string[]): readonly string[] => [
    "mcp",
    "add",
    name,
    "--",
    command,
    ...args,
  ],
  addHttp: (name: string, url: string): readonly string[] => ["mcp", "add", name, "--url", url],
  remove: (name: string): readonly string[] => ["mcp", "remove", name],
};
