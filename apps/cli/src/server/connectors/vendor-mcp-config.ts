// the default agent's own MCP config, read and edited through that vendor's bundled binary, one port
// per harness: the servers Settings shows are the ones a session of that agent loads, since there is
// no second registry. Every spawn is the one vendor spawn policy (`../agents/vendor-process.ts`),
// never in the vault: a vendor reads project config from its cwd.

import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type {
  HarnessDefinition,
  HarnessId,
  VendorExit,
} from "@repo/agent-runtime/acp/harness-registry";
import type {
  ConnectorAuth,
  ConnectorTarget,
  ConnectorTargetInput,
} from "@repo/api/local/connectors/connectors-schema";
import { runVendor } from "../agents/vendor-process";
import type { VendorProcessContext, VendorRun } from "../agents/vendor-process";
import type { McpSignInEnd, McpSignInRun } from "./mcp-sign-ins";

export interface VendorMcpServer {
  name: string;
  target: ConnectorTarget;
  auth: ConnectorAuth;
}

// not-a-url: a row the vendor signs in to nothing for. unavailable: the vendor refused, stalled or
// is missing, or its config could not be read, and the message says which.
export type VendorMcpRefusal = "already-exists" | "not-found" | "not-a-url" | "unavailable";

export class VendorMcpError extends Error {
  readonly kind: VendorMcpRefusal;

  constructor(kind: VendorMcpRefusal, message: string) {
    super(message);
    this.name = "VendorMcpError";
    this.kind = kind;
  }
}

export interface VendorMcpConfig {
  // the file the vendor keeps its user-level servers in.
  configPath: string;
  list: () => Promise<VendorMcpServer[]>;
  // a sign-in the vendor started on its own comes back as that sign-in, running or already lost.
  add: (name: string, target: ConnectorTargetInput) => Promise<McpSignInRun | null>;
  remove: (name: string) => Promise<void>;
  signIn: (name: string) => Promise<McpSignInRun>;
}

export type VendorMcpConfigs = Readonly<Record<HarnessId, VendorMcpConfig>>;

// what an add, a remove or a read may take; a sign-in has its own window.
export const VENDOR_MCP_TIMEOUT_MS = 30_000;

const STDERR_TAIL_LINES = 5;

// the address a vendor prints for a browser that did not open, taken only once a space or line
// end closes it, so a chunk boundary never exposes half of one.
const PRINTED_URL = /https?:\/\/\S+(?=\s)/u;

// a pty hands back the vendor's colours and carriage returns with its words.
const plainText = (output: string): string => stripVTControlCharacters(output).replaceAll("\r", "");

const lines = (text: string): string[] =>
  plainText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const missingRuntime = (harness: HarnessDefinition): string =>
  `This copy of inteligir is missing its ${harness.displayName} runtime`;

// the vendor's own words: its stderr's last lines, else the last line it printed, which is where a
// pty puts both.
const exitDetail = (harness: HarnessDefinition, doing: string, exit: VendorExit): string => {
  const stderr = lines(exit.stderr).slice(-STDERR_TAIL_LINES);
  const said = stderr.length > 0 ? stderr : lines(exit.stdout).slice(-1);
  return said.length === 0
    ? `${harness.displayName} stopped ${doing} (exit ${String(exit.code)})`
    : `${harness.displayName} could not finish ${doing}: ${said.join("\n")}`;
};

// what a run that did not do its work says of it; exit 0 is its caller's to read first.
export const failureOf = (harness: HarnessDefinition, doing: string, run: VendorRun): string => {
  switch (run.kind) {
    case "exited": {
      return exitDetail(harness, doing, run);
    }
    case "stopped": {
      return `${harness.displayName} did not finish ${doing} within ${String(VENDOR_MCP_TIMEOUT_MS / 1000)}s`;
    }
    case "missing": {
      return missingRuntime(harness);
    }
    case "failed": {
      return run.detail;
    }
    // no default
  }
};

export const succeeded = (run: VendorRun): boolean => run.kind === "exited" && run.code === 0;

// a run whose answer is the work: anything but exit 0 is a refusal in the vendor's words. answers
// what it printed.
export const runVendorConfig = async (
  harness: HarnessDefinition,
  args: readonly string[],
  context: VendorProcessContext,
  doing: string,
): Promise<string> => {
  const run = await runVendor(harness, args, context, {
    signal: AbortSignal.timeout(VENDOR_MCP_TIMEOUT_MS),
  });
  if (run.kind === "exited" && run.code === 0) {
    return run.stdout;
  }
  throw new VendorMcpError("unavailable", failureOf(harness, doing, run));
};

export interface WatchedVendorRun {
  stop: () => void;
  ended: Promise<VendorRun>;
  authUrl: () => string | null;
  // settles with the first address the vendor prints, which only a sign-in does.
  urlPrinted: Promise<string>;
}

// a vendor run left going while a person finishes in the browser: stopped only by `stop`.
export const watchVendorRun = (
  harness: HarnessDefinition,
  args: readonly string[],
  context: VendorProcessContext,
  options: { pty: boolean },
): WatchedVendorRun => {
  const stop = new AbortController();
  let printed = "";
  let authUrl: string | null = null;
  const urlPrinted = Promise.withResolvers<string>();
  const onStdout = (chunk: string): void => {
    printed += chunk;
    const url = authUrl === null ? PRINTED_URL.exec(plainText(printed))?.[0] : undefined;
    if (url !== undefined && URL.canParse(url)) {
      authUrl = url;
      urlPrinted.resolve(url);
    }
  };
  const ended = (async (): Promise<VendorRun> => {
    if (options.pty) {
      return await runVendor(harness, args, context, { onStdout, pty: true, signal: stop.signal });
    }
    // held open while it runs: a vendor waiting on the browser may also read a pasted answer, and
    // end of input would read as none coming.
    const stdin = new PassThrough();
    try {
      return await runVendor(harness, args, context, { onStdout, signal: stop.signal, stdin });
    } finally {
      stdin.destroy();
    }
  })();
  return {
    authUrl: () => authUrl,
    ended,
    stop: () => {
      stop.abort();
    },
    urlPrinted: urlPrinted.promise,
  };
};

const signInEnd = (harness: HarnessDefinition, run: VendorRun): McpSignInEnd => {
  if (succeeded(run)) {
    return { kind: "signed-in" };
  }
  return run.kind === "stopped"
    ? { kind: "stopped" }
    : { detail: failureOf(harness, "signing in", run), kind: "failed" };
};

// a sign-in over before anything could wait on it.
export const failedSignIn = (detail: string): McpSignInRun => ({
  authUrl: () => null,
  ended: Promise.resolve({ detail, kind: "failed" }),
  stop: () => {
    /* empty */
  },
});

export const signInRunOf = (
  harness: HarnessDefinition,
  watched: WatchedVendorRun,
): McpSignInRun => ({
  authUrl: watched.authUrl,
  ended: (async () => signInEnd(harness, await watched.ended))(),
  stop: watched.stop,
});

// the refusals every port answers from its own list before a vendor runs.
export const requireRow = (
  harness: HarnessDefinition,
  servers: readonly VendorMcpServer[],
  name: string,
): VendorMcpServer => {
  const row = servers.find((server) => server.name === name);
  if (row === undefined) {
    throw new VendorMcpError(
      "not-found",
      `${harness.displayName} has no connector named "${name}"`,
    );
  }
  return row;
};

export const refuseTaken = (
  harness: HarnessDefinition,
  servers: readonly VendorMcpServer[],
  name: string,
): void => {
  if (servers.some((server) => server.name === name)) {
    throw new VendorMcpError(
      "already-exists",
      `${harness.displayName} already has a connector named "${name}" — remove it first, or pick another name`,
    );
  }
};

export const requireUrlRow = (row: VendorMcpServer): void => {
  if (row.target.kind !== "http") {
    throw new VendorMcpError(
      "not-a-url",
      `"${row.name}" is not a web address, so there is nothing to sign in to`,
    );
  }
};
