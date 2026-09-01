// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed runtime surface: no skills, no fork/rewind, no goals, no dynamic
// tools / tool calls, no archive/rename, no background-work reporting, no
// ACP.
//
// `AgentRuntime` names WHAT THE HOST CALLS and nothing else. The vendored
// posture does not extend to this interface: it has one implementation, that
// implementation is this repo's own ACP adapter over a protocol bb never
// spoke, and a method kept "for the re-vendor" is a stub every test double
// must write and every reader mistakes for a live capability.

import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { ProviderEvent } from "./vocabulary/provider-event.js";
import type { ProviderEventUserContent } from "./vocabulary/provider-event.js";

export type AgentRuntimeShellEnvironment = Record<string, string>;

/** What a turn's prompt is made of; bb's PromptInput, mentions dropped. */
export type PromptInput = ProviderEventUserContent;

/**
 * Final per-thread state snapshot taken when a provider process exits,
 * captured before the runtime clears the thread's state. This is the only way
 * consumers can distinguish an idle session from a crashed active turn or a
 * turn request awaiting its first provider lifecycle event.
 */
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
  /** Working directory for provider processes. */
  workspacePath: string;

  /** Environment variables passed to ALL provider processes. */
  env?: Record<string, string>;

  /** Environment variables injected into agent shell execution via adapters.
   *  A getter, read at every adapter spawn, so a host-side edit reaches the
   *  NEXT session without rebuilding the runtime — the mcpServers rule. */
  shellEnv?: () => AgentRuntimeShellEnvironment;

  /** Called when a provider emits a translated event.
   *  Every event has `threadId` (host id) and `providerThreadId` (provider's internal id). */
  onEvent: (event: ProviderEvent) => void;

  /** Called when a provider pauses for user permission or approval.
   *  The runtime converts provider-native requests into the shared pending-interaction contract. */
  onInteractiveRequest?: (
    request: PendingInteractionCreate,
  ) => Promise<PendingInteractionResolution>;

  /** Called on provider stderr lines. */
  onStderr?: (line: string, threadId?: string) => void;

  /** Called when a provider process exits unexpectedly. */
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

  /**
   * Stops idle live provider sessions without deleting host thread state or
   * provider history. The next turn must resume from the persisted provider
   * thread id.
   */
  reapIdleProviderSessions(
    args: ReapIdleProviderSessionsArgs,
  ): Promise<ReapIdleProviderSessionsResult>;

  /** Whether the runtime currently hosts the thread (turns can run on it). */
  hasThread(threadId: string): boolean;

  shutdown(): Promise<void>;
}
