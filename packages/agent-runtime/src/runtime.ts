// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
//
// Coordinates provider processes and bridges provider JSON-RPC traffic into
// runtime thread events and pending interactions. Trimmed relative to
// upstream: no skills, no fork/rewind staging, no goals, no background-work
// state, no dynamic tools, no archive/rename, no ACP, no bridge processes,
// and no archived-session recovery (archiving itself is not carried). The
// codex account-restart path (auth/rate-limit errors poison a thread-scoped
// app-server process; the next turn replaces it and resumes by provider
// thread id) IS carried — it is what lets a re-login be picked up without
// restarting this host. See PROVENANCE.md.

import { z } from "zod";
import type {
  AdapterCommand,
  ProviderAdapter,
  ProviderCommandPlan,
  ProviderRequestCommandPlan,
} from "./provider-adapter.js";
import type { InstructionMode } from "./vocabulary/shared-types.js";
import type { ProviderErrorCategory, ProviderEvent } from "./vocabulary/provider-event.js";
import {
  assertProviderSupportsExecutionOptions,
  toProviderExecutionContext,
} from "./execution-options.js";
import {
  getJsonRpcStringParam,
  ignoredJsonRpcResultSchema,
  type JsonRpcObject,
  parseJsonRpcLine,
  type SendJsonRpcRequestArgs,
  sendJsonRpcRequest,
  settleJsonRpcResponse,
} from "./runtime-json-rpc.js";
import {
  handleRuntimeProviderRequest,
  type ResolveRuntimeProviderRequestThreadIdArgs,
} from "./runtime-provider-requests.js";
import {
  RuntimeProviderProcessManager,
  type ProviderAdapterFactory,
  type RuntimeProviderProcess,
} from "./runtime-provider-process.js";
import { RuntimeThreadIdentityRegistry, stampThreadEventScope } from "./runtime-thread-identity.js";
import { RuntimeTurnReplayFilter } from "./runtime-turn-replay-filter.js";
import { RuntimeTurnState } from "./runtime-turn-state.js";
import type {
  AgentRuntime,
  AgentRuntimeExecutionOptions,
  AgentRuntimeOptions,
  ReapedIdleProviderSession,
} from "./types.js";
import { buildThreadShellEnvironment } from "./thread-shell-environment.js";
import { resolveThreadIdentityResult, threadIdentityResultSchema } from "./thread-identity.js";
import { createCodexProviderAdapter } from "./codex/adapter.js";

export type { ProviderAdapterFactory } from "./runtime-provider-process.js";

interface RestartCodexThreadForNextTurnArgs {
  instructions: string | undefined;
  options: AgentRuntimeExecutionOptions;
  threadId: string;
}

interface RunThreadOperationArgs<TResult> {
  threadId: string;
  work: () => Promise<TResult>;
}

interface ReapIdleProviderSessionCandidate {
  idleSinceMs: number;
  providerThreadId: string;
  threadId: string;
  runtimeConfig: ThreadRuntimeConfig;
}

interface FindReapableIdleProviderSessionArgs {
  idleForMs: number;
  nowMs: number;
  threadId: string;
}

interface ResolveProviderProcessKeyArgs {
  providerId: string;
  threadId?: string;
}

interface RequireProviderProcessArgs {
  processKey: string;
  providerId: string;
}

export interface AgentRuntimeInternalOptions extends AgentRuntimeOptions {
  adapterFactory?: ProviderAdapterFactory;
}

interface ResolveProviderRequestThreadIdArgs extends ResolveRuntimeProviderRequestThreadIdArgs {
  proc: ProviderProcess;
}

// ---------------------------------------------------------------------------
// Runtime implementation
// ---------------------------------------------------------------------------

type ProviderProcess = RuntimeProviderProcess;

interface ThreadRuntimeConfig {
  instructionMode: InstructionMode;
  /**
   * The instructions the live provider session was constructed with. Frozen
   * until the next session construction (start, resume).
   */
  instructions?: string;
  options: AgentRuntimeExecutionOptions;
  processKey: string;
  providerId: string;
  workspacePath: string;
}

interface RuntimeParsedMessageArgs {
  parsed: JsonRpcObject;
  proc: ProviderProcess;
}

interface RuntimeJsonRpcResponseArgs extends RuntimeParsedMessageArgs {
  parsedId: string | number;
}

interface EmitTranslatedEventsArgs {
  events: ProviderEvent[];
  proc: ProviderProcess;
  sourceThreadId?: string;
}

interface RequireProviderRequestPlanArgs {
  commandType: AdapterCommand["type"];
  plan: ProviderCommandPlan;
  providerId: string;
}

const CODEX_PROVIDER_ID = "codex";
const CODEX_THREAD_PROCESS_KEY_PREFIX = `${CODEX_PROVIDER_ID}\0thread:`;
const THREAD_CREATION_REQUEST_TIMEOUT_MS = 2 * 60_000;
const CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_CATEGORIES = new Set<ProviderErrorCategory>([
  "rate-limit",
  "unauthorized",
]);
const CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_TEXT_PATTERN =
  /\b(?:40[19]|429|auth(?:entication|orization)?|credits?|quota|rate[-\s]?limit(?:ed)?|unauthori[sz]ed|usage limit)\b/i;

const providerThreadStopResultSchema = z.unknown();

function requireProviderRequestPlan(
  args: RequireProviderRequestPlanArgs,
): ProviderRequestCommandPlan {
  if (args.plan.kind === "request") {
    return args.plan;
  }
  throw new Error(
    `Adapter "${args.providerId}" returned no provider request for ${args.commandType}: ${args.plan.reason}`,
  );
}

function handleJsonRpcResponse(args: RuntimeJsonRpcResponseArgs): void {
  settleJsonRpcResponse({
    id: args.parsedId,
    pending: args.proc.pending,
    response: args.parsed,
  });
}

export function createAgentRuntimeWithAdapters(options: AgentRuntimeInternalOptions): AgentRuntime {
  return createAgentRuntimeInternal(options);
}

function createAgentRuntimeInternal(options: AgentRuntimeInternalOptions): AgentRuntime {
  let nextRequestId = 1;
  const threadIdentityRegistry = new RuntimeThreadIdentityRegistry();
  const threadRuntimeConfigs = new Map<string, ThreadRuntimeConfig>();
  const codexThreadsRequiringAccountRestart = new Set<string>();
  const idleProviderSessionSinceMsByThreadId = new Map<string, number>();
  const pendingTurnStartThreadIds = new Set<string>();
  const threadOperationCounts = new Map<string, number>();
  const turnState = new RuntimeTurnState();
  const turnReplayFilter = new RuntimeTurnReplayFilter();
  const adapterFactory: ProviderAdapterFactory =
    options.adapterFactory ??
    ((providerId): ProviderAdapter => {
      if (providerId !== CODEX_PROVIDER_ID) {
        throw new Error(`Unsupported provider "${providerId}". Available providers: codex.`);
      }
      return createCodexProviderAdapter();
    });

  const providerProcesses = new RuntimeProviderProcessManager({
    adapterFactory,
    captureThreadExitState: (threadId) => ({
      activeTurnId: turnState.getActiveTurnId(threadId),
      pendingTurnStart: pendingTurnStartThreadIds.has(threadId),
      providerThreadId: threadIdentityRegistry.getProviderThreadId(threadId) ?? null,
      threadId,
    }),
    createProviderIdentityState: (providerId) =>
      threadIdentityRegistry.createProviderState({ providerId }),
    env: options.env,
    getNextRequestId: () => nextRequestId++,
    handleStdoutLine: (args) => handleStdoutLine(args.line, args.providerProcess),
    onProcessExit: options.onProcessExit,
    onProviderIdentityWaitersInterrupted: (providerProcess) =>
      threadIdentityRegistry.resolvePendingIdentityWaiters(providerProcess.identity),
    onProviderThreadDetached: (threadId) => {
      threadIdentityRegistry.clearThread(threadId);
      clearThreadRuntimeConfig(threadId);
      turnState.clearThread(threadId);
      turnReplayFilter.clearThread(threadId);
    },
    onStderr: options.onStderr,
    workspacePath: options.workspacePath,
  });

  function resolveProviderProcessKey(args: ResolveProviderProcessKeyArgs): string {
    return args.providerId !== CODEX_PROVIDER_ID || args.threadId === undefined
      ? args.providerId
      : `${CODEX_THREAD_PROCESS_KEY_PREFIX}${args.threadId}`;
  }

  function requireProviderProcess(args: RequireProviderProcessArgs): ProviderProcess {
    return providerProcesses.requireProviderProcess(args);
  }

  function requireProviderProcessForThread(threadId: string): ProviderProcess {
    const providerId = resolveProviderForThread(threadId);
    const processKey =
      threadRuntimeConfigs.get(threadId)?.processKey ?? resolveProviderProcessKey({ providerId });
    return requireProviderProcess({ processKey, providerId });
  }

  function isThreadScopedCodexProcess(proc: ProviderProcess): boolean {
    return (
      proc.providerId === CODEX_PROVIDER_ID &&
      proc.processKey.startsWith(CODEX_THREAD_PROCESS_KEY_PREFIX)
    );
  }

  async function shutdownThreadScopedCodexProcessIfIdle(proc: ProviderProcess): Promise<void> {
    if (!isThreadScopedCodexProcess(proc) || proc.identity.threadIds.size > 0) {
      return;
    }
    await providerProcesses.shutdownProvider({
      processKey: proc.processKey,
      providerId: proc.providerId,
    });
  }

  async function sendCommand<TResult>(args: {
    proc: ProviderProcess;
    message: SendJsonRpcRequestArgs<TResult>["message"];
    resultSchema: SendJsonRpcRequestArgs<TResult>["resultSchema"];
    timeoutMs?: number;
  }): Promise<TResult> {
    return sendJsonRpcRequest({
      child: args.proc.child,
      getNextId: () => nextRequestId++,
      message: args.message,
      pending: args.proc.pending,
      resultSchema: args.resultSchema,
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    });
  }

  function resolveProviderForThread(threadId: string): string {
    return threadIdentityRegistry.resolveProviderForThread(threadId);
  }

  function resolveBbThreadIdForProcess(
    proc: ProviderProcess,
    providerThreadId: string | undefined,
  ): string | undefined {
    return threadIdentityRegistry.resolveBbThreadIdForProviderThread({
      providerState: proc.identity,
      providerThreadId,
    });
  }

  function resolveProviderRequestThreadId(args: ResolveProviderRequestThreadIdArgs): string | null {
    const resolvedThreadId = resolveBbThreadIdForProcess(args.proc, args.providerThreadId);
    if (!resolvedThreadId) {
      options.onStderr?.(
        `Unable to resolve host thread id for ${args.requestKind} on provider thread "${args.providerThreadId}"`,
      );
      return null;
    }
    if (args.threadIdHint && args.threadIdHint !== resolvedThreadId) {
      options.onStderr?.(
        `Interactive request thread hint "${args.threadIdHint}" did not match resolved host thread "${resolvedThreadId}" for provider thread "${args.providerThreadId}"`,
      );
      return null;
    }

    return resolvedThreadId;
  }

  function setThreadRuntimeConfig(threadId: string, config: ThreadRuntimeConfig): void {
    codexThreadsRequiringAccountRestart.delete(threadId);
    threadRuntimeConfigs.set(threadId, config);
  }

  function clearThreadRuntimeConfig(threadId: string): void {
    codexThreadsRequiringAccountRestart.delete(threadId);
    idleProviderSessionSinceMsByThreadId.delete(threadId);
    pendingTurnStartThreadIds.delete(threadId);
    threadRuntimeConfigs.delete(threadId);
  }

  function beginThreadOperation(threadId: string): void {
    threadOperationCounts.set(threadId, (threadOperationCounts.get(threadId) ?? 0) + 1);
  }

  function finishThreadOperation(threadId: string): void {
    const current = threadOperationCounts.get(threadId);
    if (current === undefined || current <= 1) {
      threadOperationCounts.delete(threadId);
      return;
    }
    threadOperationCounts.set(threadId, current - 1);
  }

  function threadHasInFlightOperation(threadId: string): boolean {
    return threadOperationCounts.has(threadId);
  }

  async function runThreadOperation<TResult>(
    args: RunThreadOperationArgs<TResult>,
  ): Promise<TResult> {
    beginThreadOperation(args.threadId);
    try {
      return await args.work();
    } finally {
      finishThreadOperation(args.threadId);
    }
  }

  function recordProviderThreadIdentity(
    proc: ProviderProcess,
    threadId: string,
    providerThreadId: string,
  ): void {
    threadIdentityRegistry.recordProviderThreadIdentity({
      providerState: proc.identity,
      threadId,
      providerThreadId,
    });
  }

  function waitForProviderThreadIdentity(
    proc: ProviderProcess,
    threadId: string,
    timeoutMs: number,
  ): Promise<string | null> {
    return threadIdentityRegistry.waitForProviderThreadIdentity({
      providerState: proc.identity,
      threadId,
      timeoutMs,
    });
  }

  /**
   * Removes one thread's runtime state while its provider process keeps
   * running: identity, execution config, turn state (resolving pending
   * active-turn waiters with `null`), and replay-filter state.
   */
  function forgetThreadRuntimeState(proc: ProviderProcess, threadId: string): void {
    threadIdentityRegistry.forgetThread({
      providerState: proc.identity,
      threadId,
    });
    clearThreadRuntimeConfig(threadId);
    turnState.clearThread(threadId);
    turnReplayFilter.clearThread(threadId);
  }

  function markProviderSessionNotIdle(threadId: string): void {
    idleProviderSessionSinceMsByThreadId.delete(threadId);
  }

  function markHostedProviderSessionIdle(threadId: string): void {
    if (
      threadIdentityRegistry.getProviderSession(threadId) === null ||
      turnState.getActiveTurnId(threadId) !== null ||
      pendingTurnStartThreadIds.has(threadId)
    ) {
      return;
    }
    if (!idleProviderSessionSinceMsByThreadId.has(threadId)) {
      idleProviderSessionSinceMsByThreadId.set(threadId, Date.now());
    }
  }

  function observeProviderSessionIdleState(event: ProviderEvent): void {
    if (event.type === "turn/started") {
      pendingTurnStartThreadIds.delete(event.threadId);
      markProviderSessionNotIdle(event.threadId);
      return;
    }

    if (event.type === "turn/completed") {
      pendingTurnStartThreadIds.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
      return;
    }

    if (event.type === "provider/error" && event.willRetry !== true) {
      pendingTurnStartThreadIds.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
    }
  }

  function findReapableIdleProviderSession(
    args: FindReapableIdleProviderSessionArgs,
  ): ReapIdleProviderSessionCandidate | null {
    if (
      threadHasInFlightOperation(args.threadId) ||
      pendingTurnStartThreadIds.has(args.threadId) ||
      turnState.getActiveTurnId(args.threadId) !== null
    ) {
      return null;
    }

    const runtimeConfig = threadRuntimeConfigs.get(args.threadId);
    if (!runtimeConfig || runtimeConfig.providerId !== CODEX_PROVIDER_ID) {
      return null;
    }

    const providerThreadId = threadIdentityRegistry.getProviderThreadId(args.threadId);
    if (!providerThreadId) {
      return null;
    }

    const idleSinceMs = idleProviderSessionSinceMsByThreadId.get(args.threadId);
    if (idleSinceMs === undefined) {
      return null;
    }

    if (args.nowMs - idleSinceMs < args.idleForMs) {
      return null;
    }

    return {
      idleSinceMs,
      providerThreadId,
      runtimeConfig,
      threadId: args.threadId,
    };
  }

  function requireProviderThreadId(threadId: string): string {
    const providerThreadId = threadIdentityRegistry.getProviderThreadId(threadId);
    if (!providerThreadId) {
      throw new Error(`No provider thread id available for ${threadId}`);
    }
    return providerThreadId;
  }

  function shouldRestartCodexThreadAfterEvent(
    event: ProviderEvent,
    proc: ProviderProcess,
  ): boolean {
    if (
      proc.providerId !== CODEX_PROVIDER_ID ||
      event.type !== "provider/error" ||
      event.willRetry === true
    ) {
      return false;
    }

    if (
      event.errorInfo !== undefined &&
      CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_CATEGORIES.has(event.errorInfo.category)
    ) {
      return true;
    }

    const errorText = [event.message, event.detail].filter((part) => part !== undefined).join("\n");
    return CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_TEXT_PATTERN.test(errorText);
  }

  async function restartCodexThreadForNextTurnIfNeeded(
    args: RestartCodexThreadForNextTurnArgs,
  ): Promise<void> {
    if (!codexThreadsRequiringAccountRestart.has(args.threadId)) {
      return;
    }

    const currentConfig = threadRuntimeConfigs.get(args.threadId);
    if (!currentConfig || currentConfig.providerId !== CODEX_PROVIDER_ID) {
      codexThreadsRequiringAccountRestart.delete(args.threadId);
      return;
    }

    if (turnState.getActiveTurnId(args.threadId) !== null) {
      return;
    }

    const providerThreadId = requireProviderThreadId(args.threadId);
    const proc = requireProviderProcess({
      processKey: currentConfig.processKey,
      providerId: currentConfig.providerId,
    });
    if (!isThreadScopedCodexProcess(proc)) {
      codexThreadsRequiringAccountRestart.delete(args.threadId);
      return;
    }

    codexThreadsRequiringAccountRestart.delete(args.threadId);
    await providerProcesses.shutdownProvider({
      processKey: proc.processKey,
      providerId: proc.providerId,
    });

    const resumeInstructions = args.instructions ?? currentConfig.instructions;
    await runtime.resumeThread({
      threadId: args.threadId,
      providerThreadId,
      providerId: currentConfig.providerId,
      options: args.options,
      ...(resumeInstructions !== undefined ? { instructions: resumeInstructions } : {}),
      instructionMode: currentConfig.instructionMode,
    });
  }

  function emitTranslatedEvents(args: EmitTranslatedEventsArgs): void {
    for (const event of args.events) {
      if (event.type !== "thread/identity" || !event.providerThreadId) {
        continue;
      }

      if (args.proc.identity.threadIds.has(event.threadId)) {
        recordProviderThreadIdentity(args.proc, event.threadId, event.providerThreadId);
        continue;
      }

      const bbThreadId = threadIdentityRegistry.resolvePendingProviderThreadIdentity(
        args.proc.identity,
      );
      if (bbThreadId) {
        recordProviderThreadIdentity(args.proc, bbThreadId, event.providerThreadId);
      }
    }

    for (const event of args.events) {
      const resolvedBbThreadId = threadIdentityRegistry.resolveProviderEventThreadId({
        eventThreadId: event.threadId,
        providerState: args.proc.identity,
        sourceThreadId: args.sourceThreadId,
      });

      if (resolvedBbThreadId === undefined) {
        options.onStderr?.(
          `Dropping unscoped provider event ${event.type}; no host thread could be resolved`,
        );
        continue;
      }

      const stampedEvent = stampThreadEventScope({
        event,
        providerThreadId: threadIdentityRegistry.getProviderThreadId(resolvedBbThreadId),
        threadId: resolvedBbThreadId,
      });

      const replayResult = turnReplayFilter.observe(stampedEvent);
      if (replayResult.kind === "drop-replayed-turn-start") {
        options.onStderr?.(
          `Dropping replayed turn/started on already completed turn "${replayResult.turnId}" in thread "${replayResult.threadId}".`,
        );
        continue;
      }

      turnState.observe(replayResult.event);
      observeProviderSessionIdleState(replayResult.event);
      if (shouldRestartCodexThreadAfterEvent(replayResult.event, args.proc)) {
        codexThreadsRequiringAccountRestart.add(replayResult.event.threadId);
      }
      options.onEvent(replayResult.event);
    }
  }

  function handleProviderNotification(args: RuntimeParsedMessageArgs): void {
    const sourceThreadId = getJsonRpcStringParam(args.parsed, "threadId");
    emitTranslatedEvents({
      events: args.proc.adapter.translateEvent(args.parsed),
      proc: args.proc,
      ...(sourceThreadId !== undefined ? { sourceThreadId } : {}),
    });
  }

  function handleStdoutLine(line: string, proc: ProviderProcess): void {
    const parsedLine = parseJsonRpcLine(line);
    if (parsedLine.kind === "non_json" || parsedLine.kind === "invalid_json_rpc") {
      options.onStderr?.(line);
      return;
    }

    if (parsedLine.kind === "response") {
      handleJsonRpcResponse({
        parsed: parsedLine.parsed,
        parsedId: parsedLine.parsedId,
        proc,
      });
      return;
    }

    if (parsedLine.kind === "request") {
      handleRuntimeProviderRequest({
        getActiveTurnId: (threadId) => turnState.getActiveTurnId(threadId),
        getThreadExecutionOptions: (threadId) => threadRuntimeConfigs.get(threadId)?.options,
        onInteractiveRequest: options.onInteractiveRequest,
        parsedId: parsedLine.parsedId,
        parsedMethod: parsedLine.parsedMethod,
        providerProcess: proc,
        rawRequest: parsedLine.rawRequest,
        resolveThreadId: (request) =>
          resolveProviderRequestThreadId({
            ...request,
            proc,
          }),
      });
      return;
    }

    // The runtime does NOT interpret notification content — it delegates
    // entirely to the adapter's translateEvent, which knows its own wire
    // format.
    handleProviderNotification({
      parsed: parsedLine.parsed,
      proc,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const runtime: AgentRuntime = {
    async ensureProvider({ providerId, forThreadId }) {
      await providerProcesses.ensureProvider({
        processKey: resolveProviderProcessKey({
          providerId,
          ...(forThreadId !== undefined ? { threadId: forThreadId } : {}),
        }),
        providerId,
      });
    },

    async startThread({
      threadId,
      providerId,
      options: execOpts,
      instructions,
      instructionMode = "append",
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({ providerId, threadId });
          await runtime.ensureProvider({ providerId, forThreadId: threadId });

          const proc = requireProviderProcess({ processKey, providerId });
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            shouldWaitForProviderIdentity: true,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            instructionMode,
            ...(instructions !== undefined ? { instructions } : {}),
            options: execOpts,
            processKey,
            providerId,
            workspacePath: options.workspacePath,
          });

          const envVars = buildThreadShellEnvironment({
            baseShellEnv: options.shellEnv,
            threadId,
          });

          const adapterCommand: AdapterCommand = {
            type: "thread/start",
            threadId,
            cwd: options.workspacePath,
            options: toProviderExecutionContext({
              envVars,
              execOpts,
              instructions,
            }),
            instructionMode,
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId,
          });

          const result = await sendCommand({
            proc,
            message: cmd,
            resultSchema: threadIdentityResultSchema,
            timeoutMs: THREAD_CREATION_REQUEST_TIMEOUT_MS,
          });
          const providerThreadId = resolveThreadIdentityResult({
            result,
            threadId,
          });
          if (providerThreadId) {
            recordProviderThreadIdentity(proc, threadId, providerThreadId);
          }

          const resolved = await waitForProviderThreadIdentity(proc, threadId, 5000);
          if (!resolved) {
            throw new Error(
              `Provider "${providerId}" did not return a providerThreadId for thread "${threadId}" within 5 seconds`,
            );
          }

          markHostedProviderSessionIdle(threadId);
          return { providerThreadId: resolved };
        },
      });
    },

    async resumeThread({
      threadId,
      providerThreadId,
      providerId,
      options: execOpts,
      instructions,
      instructionMode = "append",
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({ providerId, threadId });
          await runtime.ensureProvider({ providerId, forThreadId: threadId });

          const proc = requireProviderProcess({ processKey, providerId });
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            shouldWaitForProviderIdentity: providerThreadId === undefined,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            instructionMode,
            ...(instructions !== undefined ? { instructions } : {}),
            options: execOpts,
            processKey,
            providerId,
            workspacePath: options.workspacePath,
          });

          if (providerThreadId) {
            recordProviderThreadIdentity(proc, threadId, providerThreadId);
          }

          const envVars = buildThreadShellEnvironment({
            baseShellEnv: options.shellEnv,
            threadId,
          });

          const adapterCommand: AdapterCommand = {
            type: "thread/resume",
            threadId,
            cwd: options.workspacePath,
            providerThreadId: providerThreadId ?? requireProviderThreadId(threadId),
            options: toProviderExecutionContext({
              envVars,
              execOpts,
              instructions,
            }),
            instructionMode,
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId,
          });

          const result = await sendCommand({
            proc,
            message: cmd,
            resultSchema: threadIdentityResultSchema,
          });
          const resolvedId =
            resolveThreadIdentityResult({ result, threadId }) ??
            providerThreadId ??
            threadIdentityRegistry.getProviderThreadId(threadId);
          if (!resolvedId) {
            throw new Error(`Provider resume did not return a thread id for ${threadId}`);
          }
          recordProviderThreadIdentity(proc, threadId, resolvedId);

          markHostedProviderSessionIdle(threadId);
          return { providerThreadId: resolvedId };
        },
      });
    },

    async runTurn({ threadId, input, options: execOpts, instructions }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          await restartCodexThreadForNextTurnIfNeeded({
            threadId,
            options: execOpts,
            instructions,
          });
          // An account restart replaces a thread-scoped Codex process, so
          // resolve the process again before constructing the turn command.
          const proc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId: pid,
          });

          const adapterCommand: AdapterCommand = {
            type: "turn/start",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
            input,
            options: toProviderExecutionContext({
              envVars: {},
              execOpts,
              instructions,
            }),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          pendingTurnStartThreadIds.add(threadId);
          markProviderSessionNotIdle(threadId);
          try {
            await sendCommand({
              proc,
              message: cmd,
              resultSchema: ignoredJsonRpcResultSchema,
            });
          } catch (error) {
            pendingTurnStartThreadIds.delete(threadId);
            markHostedProviderSessionIdle(threadId);
            throw error;
          }
        },
      });
    },

    async steerTurn({ threadId, expectedTurnId, input, options: execOpts }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId: pid,
          });

          const activeTurnId = turnState.getActiveTurnId(threadId);
          if (activeTurnId !== expectedTurnId) {
            options.onStderr?.(
              `Ignoring stale steer for thread "${threadId}" on turn "${expectedTurnId}"; active turn is ${activeTurnId ?? "none"}.`,
            );
            return {
              status: "stale",
              activeTurnId,
            };
          }

          const adapterCommand: AdapterCommand = {
            type: "turn/steer",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
            expectedTurnId,
            input,
            options: toProviderExecutionContext({
              envVars: {},
              execOpts,
              instructions: undefined,
            }),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          await sendCommand({
            proc,
            message: cmd,
            resultSchema: ignoredJsonRpcResultSchema,
          });
          return { status: "steered" };
        },
      });
    },

    async stopThread({ threadId }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          const providerThreadId = requireProviderThreadId(threadId);
          const activeTurnId = turnState.getActiveTurnId(threadId);
          const adapterCommand: AdapterCommand = {
            type: "thread/stop",
            threadId,
            providerThreadId,
            activeTurnId,
          };
          const cmd = proc.adapter.buildCommandPlan(adapterCommand);

          if (cmd.kind === "noop") {
            if (activeTurnId) {
              throw new Error(
                `Adapter "${pid}" returned no provider request for thread/stop with active turn: ${cmd.reason}`,
              );
            }
            forgetThreadRuntimeState(proc, threadId);
            await shutdownThreadScopedCodexProcessIfIdle(proc);
            return;
          }

          await sendCommand({
            proc,
            message: cmd,
            resultSchema: providerThreadStopResultSchema,
          });
          forgetThreadRuntimeState(proc, threadId);
          await shutdownThreadScopedCodexProcessIfIdle(proc);
        },
      });
    },

    async listModels({ providerId }) {
      await runtime.ensureProvider({ providerId });
      const proc = requireProviderProcess({
        processKey: resolveProviderProcessKey({ providerId }),
        providerId,
      });
      const command = requireProviderRequestPlan({
        commandType: "model/list",
        plan: proc.adapter.buildCommandPlan({ type: "model/list" }),
        providerId,
      });
      const result = await sendCommand({
        proc,
        message: command,
        resultSchema: ignoredJsonRpcResultSchema,
      });
      return proc.adapter.parseModelListResult(result);
    },

    listRunningProviders() {
      return providerProcesses.listRunningProviders();
    },

    getActiveTurnId(threadId) {
      return turnState.getActiveTurnId(threadId);
    },

    waitForActiveTurn(threadId, args) {
      return turnState.waitForActiveTurn({
        threadId,
        timeoutMs: args.timeoutMs,
      });
    },

    getProviderSession(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId);
    },

    async reapIdleProviderSessions({ idleForMs, nowMs }) {
      const reapedSessions: ReapedIdleProviderSession[] = [];
      // Snapshot first: stopThread mutates the map mid-iteration.
      const configuredThreadIds = Array.from(threadRuntimeConfigs.keys());
      for (const threadId of configuredThreadIds) {
        const candidate = findReapableIdleProviderSession({
          idleForMs,
          nowMs,
          threadId,
        });
        if (!candidate) {
          continue;
        }

        let proc: ProviderProcess;
        try {
          proc = requireProviderProcess({
            processKey: candidate.runtimeConfig.processKey,
            providerId: candidate.runtimeConfig.providerId,
          });
        } catch {
          continue;
        }
        if (!isThreadScopedCodexProcess(proc)) {
          continue;
        }

        try {
          await runtime.stopThread({ threadId: candidate.threadId });
        } catch (error) {
          // One damaged session must not block every later candidate, so
          // report the failure and let the next pass retry this thread.
          options.onStderr?.(
            `Provider session release failed for ${candidate.threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
        reapedSessions.push({
          idleForMs: Math.max(0, nowMs - candidate.idleSinceMs),
          providerId: candidate.runtimeConfig.providerId,
          providerThreadId: candidate.providerThreadId,
          threadId: candidate.threadId,
        });
      }

      return { reapedSessions };
    },

    hasThread(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId) !== null;
    },

    getLiveThreadIds() {
      return [...new Set([...turnState.getActiveThreadIds(), ...pendingTurnStartThreadIds])];
    },

    async shutdown() {
      idleProviderSessionSinceMsByThreadId.clear();
      pendingTurnStartThreadIds.clear();
      threadOperationCounts.clear();
      turnState.clear();
      turnReplayFilter.clear();
      await providerProcesses.shutdown();
    },
  };

  return runtime;
}
