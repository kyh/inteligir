// codex answers `mcp list --json` with each server's transport and auth status, over
// `$CODEX_HOME/config.toml`. Its `mcp add` silently replaces a server of the same name and its
// `mcp remove` of a missing one exits 0, so both refusals are the list's, read before anything runs.
// `mcp add --url` starts the server's sign-in itself when the server publishes one, and runs until
// that is finished: an add that has printed a sign-in address is handed back as that sign-in, and
// one that exits having added the row but failed its sign-in says so on the row. `mcp login` needs
// no terminal.

import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type { ConnectorAuth, ConnectorTarget } from "@repo/api/local/connectors/connectors-schema";
import type { VendorProcessContext, VendorRun } from "../agents/vendor-process";
import type { McpSignInRun } from "./mcp-sign-ins";
import {
  failedSignIn,
  failureOf,
  refuseTaken,
  requireRow,
  requireUrlRow,
  runVendorConfig,
  signInRunOf,
  succeeded,
  VENDOR_MCP_TIMEOUT_MS,
  VendorMcpError,
  watchVendorRun,
} from "./vendor-mcp-config";
import type { VendorMcpConfig, VendorMcpServer } from "./vendor-mcp-config";

const CODEX = HARNESSES.codex;

const nonEmpty = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

export const codexConfigPath = (env: NodeJS.ProcessEnv): string =>
  path.join(
    nonEmpty(env.CODEX_HOME) ?? path.join(nonEmpty(env.HOME) ?? homedir(), ".codex"),
    "config.toml",
  );

const codexTargetSchema = z.union([
  z
    .looseObject({ type: z.literal("streamable_http"), url: z.string().min(1) })
    .transform(({ url }): ConnectorTarget => ({ kind: "http", url })),
  z
    .looseObject({
      args: z.array(z.string()).nullable().optional(),
      command: z.string().min(1),
      type: z.literal("stdio"),
    })
    .transform(({ args, command }): ConnectorTarget => ({
      args: args ?? [],
      command,
      kind: "stdio",
    })),
  z
    .looseObject({ type: z.string().min(1) })
    .transform(({ type }): ConnectorTarget => ({ kind: "other", type })),
]);

const codexServerSchema = z.looseObject({
  auth_status: z.string().nullable().optional(),
  name: z.string().min(1),
  transport: codexTargetSchema,
});

// oauth: codex holds a token for it. a bearer token or no auth at all is one it never signs in to.
const CODEX_AUTH = new Map<string, ConnectorAuth>([
  ["bearer_token", "not-needed"],
  ["not_logged_in", "needs-sign-in"],
  ["o_auth", "signed-in"],
  ["unsupported", "not-needed"],
]);

// a row codex lists in a shape this build cannot read is left out rather than failing the list.
const parseCodexServers = (stdout: string): VendorMcpServer[] => {
  const unreadable = new VendorMcpError(
    "unavailable",
    `${CODEX.displayName} listed its connectors in a shape inteligir cannot read`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw unreadable;
  }
  const rows = z.array(z.unknown()).safeParse(parsed);
  if (!rows.success) {
    throw unreadable;
  }
  return rows.data.flatMap((row) => {
    const server = codexServerSchema.safeParse(row);
    return server.success
      ? [
          {
            auth: CODEX_AUTH.get(server.data.auth_status ?? "") ?? "unknown",
            name: server.data.name,
            target: server.data.transport,
          },
        ]
      : [];
  });
};

type AddProgress = { kind: "ended"; run: VendorRun } | { kind: "signing-in" };

export const createCodexMcpConfig = (context: VendorProcessContext): VendorMcpConfig => {
  const list = async (): Promise<VendorMcpServer[]> =>
    parseCodexServers(
      await runVendorConfig(CODEX, ["mcp", "list", "--json"], context, "listing its connectors"),
    );

  const addUrl = async (name: string, url: string): Promise<McpSignInRun | null> => {
    const watched = watchVendorRun(CODEX, ["mcp", "add", name, "--url", url], context, {
      pty: false,
    });
    const deadline = setTimeout(watched.stop, VENDOR_MCP_TIMEOUT_MS);
    const first = await Promise.race([
      watched.ended.then((run): AddProgress => ({ kind: "ended", run })),
      watched.urlPrinted.then((): AddProgress => ({ kind: "signing-in" })),
    ]);
    clearTimeout(deadline);
    if (first.kind === "signing-in") {
      return signInRunOf(CODEX, watched);
    }
    const { run } = first;
    if (succeeded(run)) {
      return null;
    }
    const servers = await list();
    if (!servers.some((server) => server.name === name)) {
      throw new VendorMcpError("unavailable", failureOf(CODEX, `adding ${name}`, run));
    }
    return failedSignIn(failureOf(CODEX, "signing in", run));
  };

  return {
    add: async (name, target) => {
      refuseTaken(CODEX, await list(), name);
      if (target.kind === "http") {
        return await addUrl(name, target.url);
      }
      await runVendorConfig(
        CODEX,
        ["mcp", "add", name, "--", target.command, ...target.args],
        context,
        `adding ${name}`,
      );
      return null;
    },
    configPath: codexConfigPath(context.env),
    list,
    remove: async (name) => {
      requireRow(CODEX, await list(), name);
      await runVendorConfig(CODEX, ["mcp", "remove", "--", name], context, `removing ${name}`);
    },
    signIn: async (name) => {
      requireUrlRow(requireRow(CODEX, await list(), name));
      return signInRunOf(
        CODEX,
        watchVendorRun(CODEX, ["mcp", "login", "--", name], context, { pty: false }),
      );
    },
  };
};
