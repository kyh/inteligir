// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// AgentRuntime carries only what the host calls: a method kept for a re-vendor is a stub every test
// double must write.

import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { ProviderEvent } from "./vocabulary/provider-event.js";

export type AgentRuntimeShellEnvironment = Record<string, string>;

export type PromptInput =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

export interface AgentRuntimeOptions {
  workspacePath: string;

  // a getter read at every spawn, so a host-side edit reaches the next session without rebuilding
  // the runtime.
  shellEnv?: () => AgentRuntimeShellEnvironment;

  onEvent: (event: ProviderEvent) => void;

  onInteractiveRequest?: (
    request: PendingInteractionCreate,
  ) => Promise<PendingInteractionResolution>;

  onStderr?: (line: string, threadId?: string) => void;
}

export interface StartThreadArgs {
  threadId: string;
  providerId: string;
}

export interface StartThreadResult {
  providerThreadId: string;
}

export interface ResumeThreadArgs {
  threadId: string;
  providerThreadId?: string;
  providerId: string;
}

export interface ResumeThreadResult {
  providerThreadId: string;
  // true when the agent loaded the persisted session, history included; false when it could not
  // and opened a fresh one, which remembers nothing it was told.
  loaded: boolean;
}

export interface RunTurnArgs {
  threadId: string;
  input: PromptInput[];
}

export interface ReapIdleProviderSessionsArgs {
  idleForMs: number;
  nowMs: number;
}

export interface ReapedIdleProviderSession {
  idleForMs: number;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface ReapIdleProviderSessionsResult {
  reapedSessions: ReapedIdleProviderSession[];
}

export interface AgentRuntime {
  startThread: (args: StartThreadArgs) => Promise<StartThreadResult>;

  resumeThread: (args: ResumeThreadArgs) => Promise<ResumeThreadResult>;

  runTurn: (args: RunTurnArgs) => Promise<void>;

  reapIdleProviderSessions: (
    args: ReapIdleProviderSessionsArgs,
  ) => Promise<ReapIdleProviderSessionsResult>;

  hasThread: (threadId: string) => boolean;

  // asks the agent to stop the thread's running turn and resolves once the ask is on the wire. the
  // turn still ends through its own prompt, as interrupted; an agent that never answers is the
  // host's to close. a thread with no running turn is a no-op.
  cancelTurn: (threadId: string) => Promise<void>;

  // ends the thread's provider session, whichever phase it is in, and resolves once its child is gone. a
  // turn it was running emits nothing more: the host that closed it settles that turn itself.
  closeThread: (threadId: string) => Promise<void>;

  shutdown: () => Promise<void>;
}
