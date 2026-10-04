// the default agent's own MCP config, read and edited through that vendor's bundled binary, one port
// per harness: the servers Settings shows are the ones a session of that agent loads, since there is
// no second registry. Every spawn is the one vendor spawn policy (`../agents/vendor-process.ts`),
// never in the vault: a vendor reads project config from its cwd.

import { PassThrough } from "node:stream";
import type { HarnessDefinition, HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type {
  ConnectorAuth,
  ConnectorTarget,
  ConnectorTargetInput,
} from "@repo/contract/local/connectors/connectors-schema";
import { failureOf, printedUrlWatcher, runVendor, succeeded } from "../agents/vendor-process";
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
  list: () => Promise<VendorMcpServer[]>;
  // a sign-in the vendor started on its own comes back as that sign-in, running or already lost.
  add: (name: string, target: ConnectorTargetInput) => Promise<McpSignInRun | null>;
  remove: (name: string) => Promise<void>;
  signIn: (name: string) => Promise<McpSignInRun>;
}

export type VendorMcpConfigs = Readonly<Record<HarnessId, VendorMcpConfig>>;

// what an add, a remove or a read may take; a sign-in has its own window.
export const VENDOR_MCP_TIMEOUT_MS = 30_000;

const PRINTED_URL = /https?:\/\/\S+(?=\s)/u;

export const nonEmpty = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

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
  if (succeeded(run)) {
    return run.stdout;
  }
  throw new VendorMcpError("unavailable", failureOf(harness, doing, run, VENDOR_MCP_TIMEOUT_MS));
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
  const printed = printedUrlWatcher(PRINTED_URL);
  const urlPrinted = Promise.withResolvers<string>();
  const onStdout = (chunk: string): void => {
    printed.onStdout(chunk);
    const url = printed.authUrl();
    if (url !== null) {
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
    authUrl: printed.authUrl,
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
    : { detail: failureOf(harness, "signing in", run, VENDOR_MCP_TIMEOUT_MS), kind: "failed" };
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
