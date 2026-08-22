// The ACP agent runtime (issue #588): the AgentRuntime interface — the seam
// runtime-manager and the scripted driver already share — implemented over
// Zed's agent-client-protocol. One adapter CHILD PER THREAD (the session is
// the process), the official client lib owning the wire, and every harness
// difference confined to the registry's data.
//
// Turn identity is MINTED HERE: ACP has no turn ids — a prompt request's
// response IS the turn's end — so each prompt gets a host-minted provider
// turn id, `turn/started` is emitted at send, and the response (or its
// rejection) closes the mapper. `runTurn` resolves once the prompt is ON THE
// WIRE, not when it settles: the caller's send must return while the turn
// streams, exactly as the app-server runtime behaved.
//
// Steering does not exist in ACP. The runtime says so through
// `capabilities.supportsSteer === false` and answers every steer as stale —
// the driver's job is to refuse the steer UP FRONT so the message queues.

import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type Client,
  type ContentBlock,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type McpServer,
} from "@zed-industries/agent-client-protocol";
import type { PendingInteractionResolution } from "@repo/domain/pending-interactions";
import type {
  AgentRuntime,
  AgentRuntimeOptions,
  AgentRuntimeProcessExitThreadState,
  EnsureProviderArgs,
  ListModelsArgs,
  ReapIdleProviderSessionsArgs,
  ReapIdleProviderSessionsResult,
  ResumeThreadArgs,
  ResumeThreadResult,
  RunTurnArgs,
  StartThreadArgs,
  StartThreadResult,
  SteerTurnArgs,
  SteerTurnResult,
  StopThreadArgs,
  PromptInput,
  AgentRuntimeShellEnvironment,
} from "../types.js";
import { AcpTurnMapper } from "./acp-event-mapping.js";
import { toApprovalPayload, toPermissionOutcome } from "./acp-permission-mapping.js";
import { buildThreadShellEnvironment } from "../thread-shell-environment.js";
import { requireHarness, type HarnessDefinition } from "./harness-registry.js";

const SESSION_SHUTDOWN_GRACE_MS = 1_000;

/** process.env parsed at its boundary: only the defined entries. */
function definedProcessEnv(): AgentRuntimeShellEnvironment {
  const env: AgentRuntimeShellEnvironment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface AcpSpawnedAdapter {
  child: ChildProcess;
}

/** One MCP server for a session, in the runtime's own vocabulary — mapped to
 * the ACP lib's wire shape at session creation. A GETTER on the options so
 * registry edits reach the NEXT session without rebuilding the runtime. */
export type AcpMcpServerConfig =
  | { name: string; kind: "stdio"; command: string; args: string[] }
  | { name: string; kind: "http"; url: string; headers?: Record<string, string> };

export interface AcpAgentRuntimeOptions extends AgentRuntimeOptions {
  /** Model override routed into every adapter child, each harness's own way. */
  model?: string;
  /** The enabled connector rows every session gets (issue #591). */
  mcpServers?: () => AcpMcpServerConfig[];
  /** Test seam: replace the child spawn with an in-memory adapter. */
  spawnAdapter?: (harness: HarnessDefinition, env: Record<string, string>) => AcpSpawnedAdapter;
}

interface AcpSession {
  threadId: string;
  providerId: string;
  harness: HarnessDefinition;
  child: ChildProcess;
  connection: ClientSideConnection;
  agentCapabilities: InitializeResponse["agentCapabilities"];
  providerThreadId: string | null;
  activeMapper: AcpTurnMapper | null;
  pendingTurnStart: boolean;
  idleSinceMs: number;
  /** Ordered teardown flag: an expected kill must not report a crash. */
  expectedExit: boolean;
  turnWaiters: Array<(turnId: string | null) => void>;
}

function resolveTurnWaiters(session: AcpSession, turnId: string | null): void {
  for (const waiter of session.turnWaiters.splice(0)) waiter(turnId);
}

let turnCounter = 0;
function mintTurnId(): string {
  turnCounter += 1;
  return `acpturn_${String(Date.now())}_${String(turnCounter)}`;
}

function promptBlocks(input: PromptInput[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const part of input) {
    switch (part.type) {
      case "text":
        blocks.push({ type: "text", text: part.text });
        break;
      case "image":
        blocks.push({ type: "resource_link", uri: part.url, name: part.url });
        break;
      case "localImage":
        blocks.push({
          type: "resource_link",
          uri: `file://${part.path}`,
          name: part.path,
        });
        break;
    }
  }
  return blocks;
}

export function createAcpAgentRuntime(options: AcpAgentRuntimeOptions): AgentRuntime {
  const sessions = new Map<string, AcpSession>();
  let shuttingDown = false;

  function emit(events: readonly import("../vocabulary/provider-event.js").ProviderEvent[]): void {
    for (const event of events) options.onEvent(event);
  }

  function sessionByProviderThreadId(providerThreadId: string): AcpSession | null {
    for (const session of sessions.values()) {
      if (session.providerThreadId === providerThreadId) return session;
    }
    return null;
  }

  function spawnAdapter(harness: HarnessDefinition, threadId: string): AcpSpawnedAdapter {
    const env = definedProcessEnv();
    Object.assign(env, options.env);
    for (const key of harness.envOmit) delete env[key];
    // The agent's shell inherits the adapter child's env — that is the whole
    // route by which the server URL and the CLI's PATH reach `inteligir …`.
    Object.assign(env, buildThreadShellEnvironment({ baseShellEnv: options.shellEnv, threadId }));
    const args = [...harness.adapterArgs];
    if (options.model !== undefined) {
      harness.applyModel(options.model, env, args);
    }
    if (options.spawnAdapter !== undefined) {
      return options.spawnAdapter(harness, env);
    }
    const child = spawn(process.execPath, [harness.adapterEntry, ...args], {
      cwd: options.workspacePath,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { child };
  }

  function buildClient(session: () => AcpSession | undefined): Client {
    return {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        const current = session();
        const handler = options.onInteractiveRequest;
        if (current === undefined || handler === undefined) {
          return { outcome: { outcome: "cancelled" } };
        }
        const turnId = current.activeMapper?.turnId ?? null;
        if (turnId === null || current.providerThreadId === null) {
          return { outcome: { outcome: "cancelled" } };
        }
        let resolution: PendingInteractionResolution;
        try {
          resolution = await handler({
            threadId: current.threadId,
            turnId,
            providerId: current.providerId,
            providerThreadId: current.providerThreadId,
            providerRequestId: params.toolCall.toolCallId,
            payload: toApprovalPayload(params),
          });
        } catch {
          return { outcome: { outcome: "cancelled" } };
        }
        return { outcome: toPermissionOutcome(params, resolution) };
      },
      async sessionUpdate(params: SessionNotification): Promise<void> {
        const current = sessionByProviderThreadId(params.sessionId);
        if (current?.activeMapper == null) return;
        emit(current.activeMapper.update(params));
      },
    };
  }

  async function openSession(threadId: string, providerId: string): Promise<AcpSession> {
    const harness = requireHarness(providerId);
    const { child } = spawnAdapter(harness, threadId);
    if (child.stdin === null || child.stdout === null) {
      throw new Error(`The ${harness.displayName} adapter spawned without stdio pipes`);
    }
    const stdinWeb: WritableStream<Uint8Array> = Writable.toWeb(child.stdin);
    // node's toWeb types the readable side `any`; piping through an identity
    // TransformStream is what stamps the chunk type without an assertion.
    const identity = new TransformStream<Uint8Array, Uint8Array>();
    void Readable.toWeb(child.stdout)
      .pipeTo(identity.writable)
      .catch(() => {});
    const stdoutWeb: ReadableStream<Uint8Array> = identity.readable;
    const connection = new ClientSideConnection(
      (_agent: Agent) => buildClient(() => sessions.get(threadId)),
      ndJsonStream(stdinWeb, stdoutWeb),
    );
    const session: AcpSession = {
      activeMapper: null,
      agentCapabilities: undefined,
      child,
      connection,
      expectedExit: false,
      harness,
      idleSinceMs: Date.now(),
      pendingTurnStart: false,
      providerId,
      providerThreadId: null,
      threadId,
      turnWaiters: [],
    };
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim() !== "") options.onStderr?.(line, threadId);
      }
    });
    child.on("exit", (code, signal) => {
      const current = sessions.get(threadId);
      if (current !== session) return;
      sessions.delete(threadId);
      const threads: AgentRuntimeProcessExitThreadState[] = [
        {
          activeTurnId: session.activeMapper?.turnId ?? null,
          pendingTurnStart: session.pendingTurnStart,
          providerThreadId: session.providerThreadId,
          threadId,
        },
      ];
      resolveTurnWaiters(session, null);
      options.onProcessExit?.({
        code,
        expected: session.expectedExit || shuttingDown,
        providerId,
        signal,
        stderr: null,
        threads,
      });
    });
    sessions.set(threadId, session);
    try {
      const initialized = await connection.initialize({
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        protocolVersion: PROTOCOL_VERSION,
      });
      session.agentCapabilities = initialized.agentCapabilities;
    } catch (error) {
      await destroySession(session);
      throw error;
    }
    return session;
  }

  async function destroySession(session: AcpSession): Promise<void> {
    session.expectedExit = true;
    sessions.delete(session.threadId);
    resolveTurnWaiters(session, null);
    if (session.child.exitCode === null && session.child.signalCode === null) {
      session.child.kill("SIGTERM");
      const exited = new Promise<void>((resolve) => {
        session.child.once("exit", () => {
          resolve();
        });
      });
      const grace = new Promise<void>((resolve) => {
        setTimeout(() => {
          session.child.kill("SIGKILL");
          resolve();
        }, SESSION_SHUTDOWN_GRACE_MS).unref?.();
      });
      await Promise.race([exited, grace]);
    }
  }

  function requireSession(threadId: string): AcpSession {
    const session = sessions.get(threadId);
    if (session === undefined) {
      throw new Error(`No live provider session for thread "${threadId}"`);
    }
    return session;
  }

  function sessionMcpServers(): McpServer[] {
    const rows = options.mcpServers?.() ?? [];
    return rows.map((row): McpServer => {
      if (row.kind === "stdio") {
        return { args: row.args, command: row.command, env: [], name: row.name };
      }
      return {
        headers: Object.entries(row.headers ?? {}).map(([name, value]) => ({ name, value })),
        name: row.name,
        type: "http",
        url: row.url,
      };
    });
  }

  const runtime: AgentRuntime = {
    async ensureProvider(_args: EnsureProviderArgs): Promise<void> {
      // Sessions are per-thread children; there is no provider-scoped
      // process to warm.
    },

    async startThread(args: StartThreadArgs): Promise<StartThreadResult> {
      const session = await openSession(args.threadId, args.providerId);
      const response = await session.connection.newSession({
        cwd: options.workspacePath,
        mcpServers: sessionMcpServers(),
      });
      session.providerThreadId = response.sessionId;
      return { providerThreadId: response.sessionId };
    },

    async resumeThread(args: ResumeThreadArgs): Promise<ResumeThreadResult> {
      const session = await openSession(args.threadId, args.providerId);
      const wantsLoad =
        args.providerThreadId !== undefined &&
        session.harness.supportsLoadSession &&
        session.agentCapabilities?.loadSession === true;
      if (wantsLoad && args.providerThreadId !== undefined) {
        try {
          await session.connection.loadSession({
            cwd: options.workspacePath,
            mcpServers: sessionMcpServers(),
            sessionId: args.providerThreadId,
          });
          session.providerThreadId = args.providerThreadId;
          return { providerThreadId: args.providerThreadId };
        } catch (error) {
          options.onStderr?.(
            `session/load failed for thread "${args.threadId}" (${error instanceof Error ? error.message : String(error)}); starting fresh`,
            args.threadId,
          );
        }
      }
      const response = await session.connection.newSession({
        cwd: options.workspacePath,
        mcpServers: sessionMcpServers(),
      });
      session.providerThreadId = response.sessionId;
      return { providerThreadId: response.sessionId };
    },

    async runTurn(args: RunTurnArgs): Promise<void> {
      const session = requireSession(args.threadId);
      if (session.providerThreadId === null) {
        throw new Error(`Thread "${args.threadId}" has no provider session id`);
      }
      if (session.activeMapper !== null) {
        throw new Error(`Thread "${args.threadId}" already has an active turn`);
      }
      const mapper = new AcpTurnMapper({
        providerThreadId: session.providerThreadId,
        threadId: args.threadId,
        turnId: mintTurnId(),
      });
      session.activeMapper = mapper;
      session.pendingTurnStart = false;
      emit(mapper.started());
      resolveTurnWaiters(session, mapper.turnId);
      void (async () => {
        try {
          const response = await session.connection.prompt({
            prompt: promptBlocks(args.input),
            sessionId: session.providerThreadId ?? "",
          });
          if (session.activeMapper !== mapper) return;
          session.activeMapper = null;
          session.idleSinceMs = Date.now();
          emit(mapper.completed(response.stopReason));
        } catch (error) {
          if (session.activeMapper !== mapper) return;
          session.activeMapper = null;
          session.idleSinceMs = Date.now();
          emit(mapper.failed(error instanceof Error ? error.message : String(error)));
        }
      })();
      // Resolve once the prompt is on the wire: the send path must return
      // while the turn streams. A queue-level flush is the closest "accepted"
      // signal the lib exposes.
      await Promise.resolve();
    },

    async steerTurn(args: SteerTurnArgs): Promise<SteerTurnResult> {
      const session = sessions.get(args.threadId);
      return {
        status: "stale",
        activeTurnId: session?.activeMapper?.turnId ?? null,
      };
    },

    async stopThread(args: StopThreadArgs): Promise<void> {
      const session = sessions.get(args.threadId);
      if (session === undefined) return;
      const mapper = session.activeMapper;
      if (mapper !== null && session.providerThreadId !== null) {
        try {
          await session.connection.cancel({ sessionId: session.providerThreadId });
        } catch {
          // The child may already be gone; the kill below is the backstop.
        }
      }
      await destroySession(session);
      if (mapper !== null) {
        emit(mapper.completed("cancelled"));
      }
    },

    async listModels(_args: ListModelsArgs): Promise<{ models: [] }> {
      // ACP advertises no model catalog; harness model choice rides launch
      // configuration (registry env/args), not a listing.
      return { models: [] };
    },

    listRunningProviders(): string[] {
      return [...new Set(Array.from(sessions.values(), (session) => session.providerId))];
    },

    getActiveTurnId(threadId: string): string | null {
      return sessions.get(threadId)?.activeMapper?.turnId ?? null;
    },

    async waitForActiveTurn(threadId: string, args: { timeoutMs: number }): Promise<string | null> {
      const session = sessions.get(threadId);
      if (session === undefined) return null;
      const active = session.activeMapper?.turnId;
      if (active !== undefined) return active;
      let settle: (turnId: string | null) => void;
      const outcome = new Promise<string | null>((resolve) => {
        settle = resolve;
      });
      const waiter = (turnId: string | null): void => {
        clearTimeout(timer);
        settle(turnId);
      };
      const timer = setTimeout(() => {
        // The splice is what makes the two paths exclusive: a fired timer
        // removes the waiter before finishing, and a fired waiter was already
        // consumed by resolveTurnWaiters' own splice.
        const index = session.turnWaiters.indexOf(waiter);
        if (index >= 0) session.turnWaiters.splice(index, 1);
        settle(null);
      }, args.timeoutMs);
      session.turnWaiters.push(waiter);
      return outcome;
    },

    getProviderSession(threadId: string) {
      const session = sessions.get(threadId);
      if (session?.providerThreadId == null) return null;
      return { providerId: session.providerId, providerThreadId: session.providerThreadId };
    },

    async reapIdleProviderSessions(
      args: ReapIdleProviderSessionsArgs,
    ): Promise<ReapIdleProviderSessionsResult> {
      const reaped: ReapIdleProviderSessionsResult["reapedSessions"] = [];
      // Snapshot: destroySession mutates the map mid-iteration.
      for (const session of Array.from(sessions.values())) {
        if (session.activeMapper !== null || session.providerThreadId === null) continue;
        const idleForMs = args.nowMs - session.idleSinceMs;
        if (idleForMs < args.idleForMs) continue;
        await destroySession(session);
        reaped.push({
          idleForMs,
          providerId: session.providerId,
          providerThreadId: session.providerThreadId,
          threadId: session.threadId,
        });
      }
      return { reapedSessions: reaped };
    },

    hasThread(threadId: string): boolean {
      return sessions.has(threadId);
    },

    getLiveThreadIds(): string[] {
      return [...sessions.values()]
        .filter((session) => session.activeMapper !== null || session.pendingTurnStart)
        .map((session) => session.threadId);
    },

    async shutdown(): Promise<void> {
      shuttingDown = true;
      await Promise.all([...sessions.values()].map((session) => destroySession(session)));
    },
  };

  return runtime;
}
