// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// AgentRuntime carries only what the host calls: a method kept for a re-vendor is a stub every test
// double must write.

import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { ProviderEvent } from "./vocabulary/provider-event.js";
import type { ProviderEventUserContent } from "./vocabulary/provider-event.js";

export type AgentRuntimeShellEnvironment = Record<string, string>;

export type PromptInput = ProviderEventUserContent;

export interface AgentRuntimeProcessExitThreadState {
  activeTurnId: string | null;
  pendingTurnStart: boolean;
  providerThreadId: string | null;
  threadId: string;
}

export interface AgentRuntimeProcessExitInfo {
  providerId: string;
  threads: AgentRuntimeProcessExitThreadState[];
  code: number | null;
  expected: boolean;
  signal: string | null;
  stderr: string | null;
}

export interface AgentRuntimeOptions {
  workspacePath: string;

  env?: Record<string, string>;

  // a getter read at every spawn, so a host-side edit reaches the next session without rebuilding
  // the runtime.
  shellEnv?: () => AgentRuntimeShellEnvironment;

  onEvent: (event: ProviderEvent) => void;

  onInteractiveRequest?: (
    request: PendingInteractionCreate,
  ) => Promise<PendingInteractionResolution>;

  onStderr?: (line: string, threadId?: string) => void;

  onProcessExit?: (info: AgentRuntimeProcessExitInfo) => void;
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
  startThread(args: StartThreadArgs): Promise<StartThreadResult>;

  resumeThread(args: ResumeThreadArgs): Promise<ResumeThreadResult>;

  runTurn(args: RunTurnArgs): Promise<void>;

  reapIdleProviderSessions(
    args: ReapIdleProviderSessionsArgs,
  ): Promise<ReapIdleProviderSessionsResult>;

  hasThread(threadId: string): boolean;

  shutdown(): Promise<void>;
}
