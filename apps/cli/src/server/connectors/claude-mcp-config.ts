// claude keeps its user-scope servers under `mcpServers` in `<CLAUDE_CONFIG_DIR ?? HOME>/.claude.json`,
// read here rather than through `claude mcp list`, which prints no machine-readable form and starts
// every stdio server to health-check it. The file keeps no answer about a sign-in, so a URL row's
// auth is unknown. Writes are the binary's: `mcp add-json -s user`, because `mcp add`'s -H and -e
// take every word after them, the name included; `mcp remove -s user`; and `mcp login`, which
// refuses to run without a terminal on its stdin and so runs under the pty wrapper. claude refuses
// a duplicate add and a missing remove itself, but both are answered from the read first.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type {
  ConnectorTarget,
  ConnectorTargetInput,
} from "@repo/api/local/connectors/connectors-schema";
import type { VendorProcessContext } from "../agents/vendor-process";
import { errnoCode } from "../errno";
import { messageOf } from "../error-message";
import {
  refuseTaken,
  requireRow,
  requireUrlRow,
  runVendorConfig,
  signInRunOf,
  VendorMcpError,
  watchVendorRun,
} from "./vendor-mcp-config";
import type { VendorMcpConfig, VendorMcpServer } from "./vendor-mcp-config";

const CLAUDE = HARNESSES.claude;
const CLAUDE_CONFIG_FILE = ".claude.json";

const nonEmpty = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

export const claudeConfigPath = (env: NodeJS.ProcessEnv): string =>
  path.join(nonEmpty(env.CLAUDE_CONFIG_DIR) ?? nonEmpty(env.HOME) ?? homedir(), CLAUDE_CONFIG_FILE);

// tolerant per row: a transport this app does not add, or a row it cannot read, is still listed,
// so it can be removed. claude reads a server with no type as stdio.
const claudeTargetSchema = z.union([
  z
    .looseObject({ type: z.literal("http"), url: z.string().min(1) })
    .transform(({ url }): ConnectorTarget => ({ kind: "http", url })),
  z
    .looseObject({
      args: z.array(z.string()).optional(),
      command: z.string().min(1),
      type: z.literal("stdio").optional(),
    })
    .transform(({ args, command }): ConnectorTarget => ({
      args: args ?? [],
      command,
      kind: "stdio",
    })),
  z
    .looseObject({ type: z.string().min(1) })
    .transform(({ type }): ConnectorTarget => ({ kind: "other", type })),
  z.unknown().transform((): ConnectorTarget => ({ kind: "other", type: "unknown" })),
]);

const claudeConfigSchema = z.looseObject({
  mcpServers: z.record(z.string(), claudeTargetSchema).optional(),
});

// the file says nothing of a sign-in, and a command needs none.
const serverOf = (name: string, target: ConnectorTarget): VendorMcpServer => ({
  auth: target.kind === "stdio" ? "not-needed" : "unknown",
  name,
  target,
});

const unreadable = (file: string, why: string): VendorMcpError =>
  new VendorMcpError("unavailable", `${CLAUDE.displayName}'s settings in ${file} ${why}`);

// absent is a claude that has never been configured; anything unreadable is refused, never empty.
const readClaudeServers = async (file: string): Promise<VendorMcpServer[]> => {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return [];
    }
    throw unreadable(file, `could not be read (${errnoCode(error) ?? messageOf(error)})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadable(file, "are not valid JSON");
  }
  const config = claudeConfigSchema.safeParse(parsed);
  if (!config.success) {
    throw unreadable(file, "are not in a shape inteligir can read");
  }
  return Object.entries(config.data.mcpServers ?? {}).map(([name, target]) =>
    serverOf(name, target),
  );
};

const serverJson = (target: ConnectorTargetInput): string =>
  JSON.stringify(
    target.kind === "http"
      ? { type: "http", url: target.url }
      : { args: target.args, command: target.command, type: "stdio" },
  );

export const createClaudeMcpConfig = (context: VendorProcessContext): VendorMcpConfig => {
  const configPath = claudeConfigPath(context.env);
  const list = async (): Promise<VendorMcpServer[]> => await readClaudeServers(configPath);
  return {
    add: async (name, target) => {
      refuseTaken(CLAUDE, await list(), name);
      await runVendorConfig(
        CLAUDE,
        ["mcp", "add-json", "-s", "user", "--", name, serverJson(target)],
        context,
        `adding ${name}`,
      );
      return null;
    },
    configPath,
    list,
    remove: async (name) => {
      requireRow(CLAUDE, await list(), name);
      await runVendorConfig(
        CLAUDE,
        ["mcp", "remove", "-s", "user", "--", name],
        context,
        `removing ${name}`,
      );
    },
    signIn: async (name) => {
      requireUrlRow(requireRow(CLAUDE, await list(), name));
      return signInRunOf(
        CLAUDE,
        watchVendorRun(CLAUDE, ["mcp", "login", "--", name], context, { pty: true }),
      );
    },
  };
};
