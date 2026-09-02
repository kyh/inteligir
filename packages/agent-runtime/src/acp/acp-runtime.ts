// one adapter child per thread. ACP has no turn ids (a prompt's response is the turn's end) and no
// steering (a prompt owns its session until it settles), so turn ids are minted here and a mid-turn
// message waits in the host's queue.

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
  ReapIdleProviderSessionsArgs,
  ReapIdleProviderSessionsResult,
  ResumeThreadArgs,
  ResumeThreadResult,
  RunTurnArgs,
  StartThreadArgs,
  StartThreadResult,
  PromptInput,
  AgentRuntimeShellEnvironment,
} from "../types.js";
import { AcpTurnMapper } from "./acp-event-mapping.js";
import { toApprovalPayload, toPermissionOutcome } from "./acp-permission-mapping.js";
import { buildThreadShellEnvironment } from "../thread-shell-environment.js";
import { requireHarness, type HarnessDefinition } from "./harness-registry.js";

const SESSION_SHUTDOWN_GRACE_MS = 1_000;

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

export type AcpMcpServerConfig =
  | { name: string; kind: "stdio"; command: string; args: string[] }
  | { name: string; kind: "http"; url: string; headers?: Record<string, string> };

export interface AcpAgentRuntimeOptions extends AgentRuntimeOptions {
  model?: string;
  // a getter, so a registry edit reaches the next session; async so an OAuth row can refresh its
  // token.
  mcpServers?: () => AcpMcpServerConfig[] | Promise<AcpMcpServerConfig[]>;
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
  expectedExit: boolean;
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
    // the agent's shell inherits this env: it is how the server url and the cli's PATH reach
    // `inteligir`.
    Object.assign(
      env,
      buildThreadShellEnvironment({ baseShellEnv: options.shellEnv?.(), threadId }),
    );
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
    // Readable.toWeb types its stream any; the identity TransformStream stamps the chunk type
    // without an assertion.
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

  async function sessionMcpServers(): Promise<McpServer[]> {
    const rows = (await options.mcpServers?.()) ?? [];
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
    async startThread(args: StartThreadArgs): Promise<StartThreadResult> {
      const session = await openSession(args.threadId, args.providerId);
      const response = await session.connection.newSession({
        cwd: options.workspacePath,
        mcpServers: await sessionMcpServers(),
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
            mcpServers: await sessionMcpServers(),
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
        mcpServers: await sessionMcpServers(),
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
      // resolve once the prompt is on the wire, not when it settles: the send must return while the
      // turn streams.
      await Promise.resolve();
    },

    async reapIdleProviderSessions(
      args: ReapIdleProviderSessionsArgs,
    ): Promise<ReapIdleProviderSessionsResult> {
      const reaped: ReapIdleProviderSessionsResult["reapedSessions"] = [];
      // snapshot: destroySession mutates the map mid-iteration.
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

    async shutdown(): Promise<void> {
      shuttingDown = true;
      await Promise.all([...sessions.values()].map((session) => destroySession(session)));
    },
  };

  return runtime;
}
