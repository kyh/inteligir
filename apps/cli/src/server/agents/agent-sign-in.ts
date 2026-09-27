// signing an agent in is the vendor's own sign-in, the method its adapter advertises, writing the
// vendor's shared store. claude's is a terminal method, which ACP has the client run: the bundled
// claude with `auth login --claudeai`, run here through the one vendor spawn policy with piped
// stdio and no terminal. That needs no pty (`script -q /dev/null`, which `claude mcp login` does
// need): read from the bundled CLI (2.1.280), the login subcommand never enters raw mode; it opens
// the browser itself (`open`, or $BROWSER) whatever its stdout is, prints the manual address as
// plain text when stdout is not a TTY, reads a pasted code line by line from stdin, and exits 0
// once the credential is stored. codex's is an agent method, which its adapter runs itself.

import { PassThrough } from "node:stream";
import { adapterSpawnEnv } from "@repo/agent-runtime/acp/acp-runtime";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import { runAgentSignIn } from "@repo/agent-runtime/acp/acp-sign-in";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type {
  AgentSignIn,
  HarnessDefinition,
  HarnessId,
  SignInMethod,
  TerminalSignIn,
  VendorAccount,
} from "@repo/agent-runtime/acp/harness-registry";
import { createVendorAccounts } from "./vendor-accounts";
import type { CreateVendorAccountsArgs } from "./vendor-accounts";
import { failureOf, printedUrlWatcher, runVendor, succeeded } from "./vendor-process";

// long enough for a person to finish in the browser, short enough that a forgotten one ends.
const SIGN_IN_CEILING_MS = 10 * 60_000;
// a sign-out only edits the vendor's own store.
const SIGN_OUT_TIMEOUT_MS = 30_000;

const PRINTED_URL = /https:\/\/\S+(?=\s)/u;

type SignInOutcome =
  | { outcome: "signed-in" }
  | { outcome: "cancelled" }
  | { outcome: "failed"; detail: string };

type SignOutOutcome = { outcome: "signed-out" } | { outcome: "failed"; detail: string };

// incomplete: not the whole code, which the vendor would refuse only on stderr and wait on.
type SignInCodeOutcome = "sent" | "incomplete" | "not-waiting";

export interface SigningIn {
  id: HarnessId;
  authUrl: string | null;
  acceptsCode: boolean;
}

export class SignInInProgressError extends Error {
  constructor(harness: HarnessDefinition) {
    super(`${harness.displayName} is already signing in; finish or cancel that first.`);
    this.name = "SignInInProgressError";
  }
}

export interface AgentAccounts {
  status: (id: HarnessId) => Promise<VendorAccount>;
  // one at a time per server: two browser logins at once would race each other's callback.
  signIn: (id: HarnessId) => Promise<SignInOutcome>;
  // ends that harness's running sign-in with its vendor process, and waits for it to have ended;
  // nothing when none runs.
  cancel: (id: HarnessId) => Promise<void>;
  signOut: (id: HarnessId) => Promise<SignOutOutcome>;
  signingIn: () => SigningIn | null;
  // hands the running sign-in a code pasted from its page, once the harness's own test says it is
  // whole; not-waiting when no sign-in of that harness reads one.
  submitCode: (id: HarnessId, code: string) => SignInCodeOutcome;
  // ends a running sign-in with its vendor process, which would otherwise outlive the server
  // waiting on a browser that is never coming back.
  dispose: () => Promise<void>;
}

export interface CreateAgentAccountsArgs extends CreateVendorAccountsArgs {
  // absent: node forks the adapter, as the agent runtime's own default does
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"] | undefined;
  signInCeilingMs?: number | undefined;
}

// how far a sign-in got before its account is re-read: `stopped` is its signal, cancel or ceiling.
type Attempt = { kind: "finished" } | { kind: "stopped" } | { kind: "failed"; detail: string };

// codes: the vendor's stdin while a terminal sign-in runs, null for a method that reads none.
interface StartedSignIn {
  attempt: Promise<Attempt>;
  codes: PassThrough | null;
}

export const createAgentAccounts = (args: CreateAgentAccountsArgs): AgentAccounts => {
  const vendor = createVendorAccounts(args);
  const context = { cwd: args.cwd, env: args.env };
  const ceilingMs = args.signInCeilingMs ?? SIGN_IN_CEILING_MS;
  const disposed = new AbortController();
  let current: {
    progress: SigningIn;
    codes: StartedSignIn["codes"];
    cancel: AbortController;
    ended: Promise<SignInOutcome>;
  } | null = null;

  const runTerminal = async (
    harness: HarnessDefinition,
    method: TerminalSignIn,
    signal: AbortSignal,
    progress: SigningIn,
    codes: PassThrough,
  ): Promise<Attempt> => {
    const printed = printedUrlWatcher(PRINTED_URL);
    const run = await runVendor(harness, method.args, context, {
      onStdout: (chunk) => {
        printed.onStdout(chunk);
        progress.authUrl = printed.authUrl();
      },
      signal,
      stdin: codes,
    });
    if (succeeded(run)) {
      return { kind: "finished" };
    }
    return run.kind === "stopped"
      ? { kind: "stopped" }
      : { detail: failureOf(harness, "signing in", run, ceilingMs), kind: "failed" };
  };

  const runAgent = async (
    harness: HarnessDefinition,
    method: AgentSignIn,
    signal: AbortSignal,
  ): Promise<Attempt> => {
    const result = await runAgentSignIn({
      cwd: args.cwd,
      env: adapterSpawnEnv(harness, { hostEnv: args.env, model: null, threadId: null }),
      harness,
      method,
      signal,
      spawnAdapter: args.spawnAdapter,
    });
    switch (result.outcome) {
      case "signed-in": {
        return { kind: "finished" };
      }
      case "cancelled": {
        return { kind: "stopped" };
      }
      case "failed": {
        return { detail: result.detail, kind: "failed" };
      }
      // no default
    }
  };

  const start = (
    harness: HarnessDefinition,
    method: SignInMethod,
    signal: AbortSignal,
    progress: SigningIn,
  ): StartedSignIn => {
    if (method.kind === "agent") {
      return { attempt: runAgent(harness, method, signal), codes: null };
    }
    const codes = new PassThrough();
    return { attempt: runTerminal(harness, method, signal, progress, codes), codes };
  };

  // a vendor that says it finished is asked again: its own answer is what a session will meet.
  const verified = async (id: HarnessId): Promise<SignInOutcome> => {
    vendor.invalidate(id);
    const account = await vendor.status(id);
    switch (account.state) {
      case "signed-in": {
        return { outcome: "signed-in" };
      }
      case "signed-out": {
        return {
          detail: `${HARNESSES[id].displayName} finished signing in but still says it is signed out.`,
          outcome: "failed",
        };
      }
      case "unknown": {
        return { detail: account.detail, outcome: "failed" };
      }
      // no default
    }
  };

  const settle = async (
    id: HarnessId,
    attempt: Attempt,
    cancelled: AbortSignal,
  ): Promise<SignInOutcome> => {
    switch (attempt.kind) {
      case "finished": {
        return await verified(id);
      }
      case "stopped": {
        return cancelled.aborted
          ? { outcome: "cancelled" }
          : {
              detail: `${HARNESSES[id].displayName}'s sign-in was not finished in time; start it again.`,
              outcome: "failed",
            };
      }
      case "failed": {
        return { detail: attempt.detail, outcome: "failed" };
      }
      // no default
    }
  };

  return {
    cancel: async (id) => {
      const running = current;
      if (running?.progress.id !== id) {
        return;
      }
      running.cancel.abort();
      await Promise.allSettled([running.ended]);
    },
    dispose: async () => {
      disposed.abort();
      if (current !== null) {
        await Promise.allSettled([current.ended]);
      }
    },
    signIn: async (id) => {
      if (current !== null) {
        throw new SignInInProgressError(HARNESSES[current.progress.id]);
      }
      const harness = HARNESSES[id];
      const method = harness.signIn;
      const progress: SigningIn = { acceptsCode: method.kind === "terminal", authUrl: null, id };
      const cancel = new AbortController();
      // a stop the user asked for, or the server's own shutdown, is a cancel; the ceiling is not.
      const cancelled = AbortSignal.any([cancel.signal, disposed.signal]);
      const signal = AbortSignal.any([cancelled, AbortSignal.timeout(ceilingMs)]);
      const { attempt, codes } = start(harness, method, signal, progress);
      const ended = (async (): Promise<SignInOutcome> =>
        await settle(id, await attempt, cancelled))();
      current = { cancel, codes, ended, progress };
      try {
        return await ended;
      } finally {
        current = null;
        codes?.destroy();
      }
    },
    signOut: async (id) => {
      const harness = HARNESSES[id];
      const run = await runVendor(harness, harness.signOutArgs, context, {
        signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
      });
      vendor.invalidate(id);
      return succeeded(run)
        ? { outcome: "signed-out" }
        : {
            detail: failureOf(harness, "signing out", run, SIGN_OUT_TIMEOUT_MS),
            outcome: "failed",
          };
    },
    signingIn: () => (current === null ? null : { ...current.progress }),
    status: vendor.status,
    submitCode: (id, code) => {
      const method = HARNESSES[id].signIn;
      const codes = current?.progress.id === id ? current.codes : null;
      if (method.kind !== "terminal" || codes === null) {
        return "not-waiting";
      }
      if (!method.acceptsCode(code)) {
        return "incomplete";
      }
      codes.write(`${code.trim()}\n`);
      return "sent";
    },
  };
};
