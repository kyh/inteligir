// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed runtime surface: no skills, no fork/rewind, no goals, no dynamic
// tools / tool calls, no archive/rename, no background-work reporting, no
// ACP.

import type { RuntimeThreadExecutionOptions } from "./vocabulary/shared-types.js";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { ProviderEvent } from "./vocabulary/provider-event.js";
import type { AvailableModel } from "./vocabulary/provider-types.js";
import type { ProviderEventUserContent } from "./vocabulary/provider-event.js";

export type AgentRuntimeShellEnvironment = Record<string, string>;

/** What a turn's prompt is made of; bb's PromptInput, mentions dropped. */
export type PromptInput = ProviderEventUserContent;

export type AgentRuntimeExecutionOptions = RuntimeThreadExecutionOptions;

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

  /** Environment variables injected into agent shell execution via adapters. */
  shellEnv?: AgentRuntimeShellEnvironment;

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

export interface EnsureProviderArgs {
  /**
   * Providers with thread-scoped processes use this to start the process for a
   * specific host thread. Omit it for provider-scoped maintenance work such as
   * model listing.
   */
  forThreadId?: string;
  providerId: string;
}

export interface StartThreadArgs {
  threadId: string;
  providerId: string;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  instructionMode?: "append" | "replace";
}

export interface StartThreadResult {
  providerThreadId: string;
}

export interface ResumeThreadArgs {
  threadId: string;
  providerThreadId?: string;
  providerId: string;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  instructionMode?: "append" | "replace";
}

export interface ResumeThreadResult {
  providerThreadId: string;
}

export interface RunTurnArgs {
  threadId: string;
  input: PromptInput[];
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
}

export interface SteerTurnArgs {
  threadId: string;
  /** The PROVIDER's turn id for the active turn. */
  expectedTurnId: string;
  input: PromptInput[];
  options: AgentRuntimeExecutionOptions;
}

export interface SteerTurnAppliedResult {
  status: "steered";
}

export interface SteerTurnStaleResult {
  status: "stale";
  activeTurnId: string | null;
}

export type SteerTurnResult = SteerTurnAppliedResult | SteerTurnStaleResult;

export interface StopThreadArgs {
  threadId: string;
}

export interface AgentRuntimeProviderSession {
  providerId: string;
  providerThreadId: string;
}

export interface WaitForActiveTurnArgs {
  timeoutMs: number;
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

export interface ListModelsArgs {
  providerId: string;
}

export interface AgentRuntime {
  ensureProvider(args: EnsureProviderArgs): Promise<void>;

  startThread(args: StartThreadArgs): Promise<StartThreadResult>;

  resumeThread(args: ResumeThreadArgs): Promise<ResumeThreadResult>;

  runTurn(args: RunTurnArgs): Promise<void>;

  steerTurn(args: SteerTurnArgs): Promise<SteerTurnResult>;

  /**
   * Stops the thread's active turn and removes the thread from the runtime:
   * identity, execution config, and turn state are cleared, so `hasThread`
   * reports `false` afterwards and the next turn must go through
   * `resumeThread`.
   */
  stopThread(args: StopThreadArgs): Promise<void>;

  listModels(args: ListModelsArgs): Promise<{ models: AvailableModel[] }>;

  listRunningProviders(): string[];

  /** Active turn id (the PROVIDER's) for the thread, or `null` when no turn is running. */
  getActiveTurnId(threadId: string): string | null;

  /**
   * Resolves with the active turn id as soon as one is known: immediately if
   * a turn is already active, on the next `turn/started` observation
   * otherwise. Resolves `null` on timeout or when the thread goes idle
   * before a turn starts.
   */
  waitForActiveTurn(threadId: string, args: WaitForActiveTurnArgs): Promise<string | null>;

  /** Provider identity for a hosted thread, or `null` when not hosted. */
  getProviderSession(threadId: string): AgentRuntimeProviderSession | null;

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

  /** Thread ids with an active turn or an accepted turn awaiting its first event. */
  getLiveThreadIds(): string[];

  shutdown(): Promise<void>;
}
