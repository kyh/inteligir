// one adapter child per thread. ACP has no turn ids (a prompt's response is the turn's end) and no
// steering (a prompt owns its session until it settles), so turn ids are minted here and a mid-turn
// message waits in the host's queue.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { PROTOCOL_VERSION, client, ndJsonStream } from "@agentclientprotocol/sdk";
import type {
  AgentCapabilities,
  ClientConnection,
  ContentBlock,
  McpServer,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { PendingInteractionResolution } from "@repo/domain/pending-interactions";
import type {
  AgentRuntime,
  AgentRuntimeOptions,
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
import type { ProviderEvent } from "../vocabulary/provider-event.js";
import { AcpTurnMapper } from "./acp-event-mapping.js";
import { toApprovalPayload, toPermissionOutcome } from "./acp-permission-mapping.js";
import { buildThreadShellEnvironment } from "../thread-shell-environment.js";
import { requireHarness } from "./harness-registry.js";
import type { HarnessDefinition, HarnessModels } from "./harness-registry.js";
import { describeProviderError } from "./provider-error.js";

const SESSION_SHUTDOWN_GRACE_MS = 1000;

// 'exit' can arrive before the child's last stderr chunk, and that chunk is usually what names the crash.
const STDERR_DRAIN_MS = 200;
const STDERR_TAIL_LINES = 20;

const definedProcessEnv = (): AgentRuntimeShellEnvironment => {
  const env: AgentRuntimeShellEnvironment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
};

// the slice of a child process the runtime drives: node's own ChildProcess, or a host's stand-in
// for a process it cannot start with child_process (the desktop shell's utility-process adapters).
export interface AdapterProcess {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill: (signal: NodeJS.Signals) => boolean;
  once: (
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => void;
}

export interface AcpSpawnedAdapter {
  child: AdapterProcess;
}

export type AcpMcpServerConfig =
  | { name: string; kind: "stdio"; command: string; args: string[] }
  | { name: string; kind: "http"; url: string; headers?: Record<string, string> };

export interface AcpAgentRuntimeOptions extends AgentRuntimeOptions {
  models?: HarnessModels;
  // a getter, so a registry edit reaches the next session; async so an OAuth row can refresh its
  // token.
  mcpServers?: () => AcpMcpServerConfig[] | Promise<AcpMcpServerConfig[]>;
  spawnAdapter?: (
    harness: HarnessDefinition,
    env: Record<string, string>,
    cwd: string,
  ) => AcpSpawnedAdapter;
}

interface AdapterExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

// one spawned child, from spawn to exit. the connection closes with the child's exit, so every
// request still pending rejects naming the harness, the exit status and the last stderr lines.
interface AcpAdapter {
  threadId: string;
  providerId: string;
  harness: HarnessDefinition;
  child: AdapterProcess;
  connection: ClientConnection;
  gone: Promise<AdapterExit>;
  // set once the runtime ends the child itself: a session/new answering during the kill registers
  // nothing, and a turn it was running is the host's to settle.
  closing: boolean;
}

interface AcpTurn {
  mapper: AcpTurnMapper;
  settled: Promise<void>;
  // aborted once the client cancels the turn: the protocol has every permission request still
  // open answered cancelled from then on, whatever the host's own answer would have been.
  cancel: AbortController;
}

// registered only once the agent has named its session, so every registered session can be prompted.
interface AcpSession {
  adapter: AcpAdapter;
  providerThreadId: string;
  turn: AcpTurn | null;
  idleSinceMs: number;
}

let turnCounter = 0;
const mintTurnId = (): string => {
  turnCounter += 1;
  return `acpturn_${String(Date.now())}_${String(turnCounter)}`;
};

const promptBlocks = (input: PromptInput[]): ContentBlock[] =>
  input.map(({ text }) => ({ text, type: "text" }));

const adapterExitError = (
  harness: HarnessDefinition,
  exit: AdapterExit,
  stderrTail: readonly string[],
): Error => {
  const how = exit.signal === null ? `code ${String(exit.code)}` : `signal ${exit.signal}`;
  const tail = stderrTail.length === 0 ? "" : `: ${stderrTail.join("\n")}`;
  return new Error(`The ${harness.displayName} adapter exited (${how})${tail}`);
};

const drained = async (stream: Readable): Promise<void> => {
  try {
    await finished(stream);
  } catch {
    // a destroyed stream has nothing more to add to the tail.
  }
};

const CANCELLED_PERMISSION: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

const whenAborted = async (signal: AbortSignal): Promise<null> => {
  if (!signal.aborted) {
    await once(signal, "abort");
  }
  return null;
};

export const createAcpAgentRuntime = (options: AcpAgentRuntimeOptions): AgentRuntime => {
  // a thread's one child in whichever phase, until it exits; `sessions` holds the ones that can be
  // prompted.
  const adapters = new Map<string, AcpAdapter>();
  const sessions = new Map<string, AcpSession>();
  let shuttingDown = false;

  const emit = (events: readonly ProviderEvent[]): void => {
    for (const event of events) {
      options.onEvent(event);
    }
  };

  const sessionOf = (threadId: string, child: AdapterProcess): AcpSession | undefined => {
    const session = sessions.get(threadId);
    return session?.adapter.child === child ? session : undefined;
  };

  const spawnAdapter = (harness: HarnessDefinition, threadId: string): AcpSpawnedAdapter => {
    const omitted = new Set(harness.envOmit);
    const env: AgentRuntimeShellEnvironment = Object.fromEntries(
      Object.entries(definedProcessEnv()).filter(([key]) => !omitted.has(key)),
    );
    // the agent's shell inherits this env: it is how the server url and the cli's PATH reach
    // `inteligir`.
    Object.assign(
      env,
      buildThreadShellEnvironment({ baseShellEnv: options.shellEnv?.(), threadId }),
    );
    // a value the host already set wins: it names an install the user chose.
    for (const [key, value] of Object.entries(harness.adapterEnv)) {
      env[key] ??= value;
    }
    const model = options.models?.[harness.id] ?? null;
    if (model !== null) {
      harness.applyModel(model, env);
    }
    if (options.spawnAdapter !== undefined) {
      return options.spawnAdapter(harness, env, options.workspacePath);
    }
    const child = spawn(process.execPath, [harness.adapterEntry], {
      cwd: options.workspacePath,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { child };
  };

  const requestPermission = async (
    current: AcpSession | undefined,
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> => {
    const handler = options.onInteractiveRequest;
    const turn = current?.turn ?? null;
    if (
      current === undefined ||
      turn === null ||
      handler === undefined ||
      turn.cancel.signal.aborted
    ) {
      return CANCELLED_PERMISSION;
    }
    let resolution: PendingInteractionResolution | null;
    try {
      resolution = await Promise.race([
        handler({
          payload: toApprovalPayload(params),
          providerId: current.adapter.providerId,
          providerRequestId: params.toolCall.toolCallId,
          providerThreadId: current.providerThreadId,
          threadId: current.adapter.threadId,
          turnId: turn.mapper.turnId,
        }),
        whenAborted(turn.cancel.signal),
      ]);
    } catch {
      return CANCELLED_PERMISSION;
    }
    // a host that clears its own waiters on a stop answers deny, and that answer can land first.
    return resolution === null || turn.cancel.signal.aborted
      ? CANCELLED_PERMISSION
      : { outcome: toPermissionOutcome(params, resolution) };
  };

  const sessionUpdate = (current: AcpSession | undefined, params: SessionNotification): void => {
    if (current?.providerThreadId === params.sessionId && current.turn !== null) {
      emit(current.turn.mapper.update(params));
    }
  };

  const connectClient = (
    session: () => AcpSession | undefined,
    stdin: WritableStream<Uint8Array>,
    stdout: ReadableStream<Uint8Array>,
  ): ClientConnection =>
    client({ name: "inteligir" })
      .onRequest(
        "session/request_permission",
        async ({ params }) => await requestPermission(session(), params),
      )
      .onNotification("session/update", ({ params }) => {
        sessionUpdate(session(), params);
      })
      .connect(ndJsonStream(stdin, stdout));

  // the runtime is ending this child itself, so it stops answering to the host at once.
  const detach = (adapter: AcpAdapter): void => {
    adapter.closing = true;
    if (sessions.get(adapter.threadId)?.adapter === adapter) {
      sessions.delete(adapter.threadId);
    }
  };

  const kill = async (adapter: AcpAdapter): Promise<void> => {
    const { child } = adapter;
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    const stopped = await Promise.race([
      (async () => {
        await adapter.gone;
        return true;
      })(),
      delay(SESSION_SHUTDOWN_GRACE_MS, false, { ref: false }),
    ]);
    if (!stopped) {
      child.kill("SIGKILL");
    }
  };

  const destroyAdapter = async (adapter: AcpAdapter): Promise<void> => {
    detach(adapter);
    await kill(adapter);
  };

  const cancelPrompt = async (session: AcpSession, turn: AcpTurn): Promise<void> => {
    turn.cancel.abort();
    await session.adapter.connection.agent.notify("session/cancel", {
      sessionId: session.providerThreadId,
    });
  };

  const closeThread = async (threadId: string): Promise<void> => {
    const adapter = adapters.get(threadId);
    if (adapter === undefined) {
      return;
    }
    const session = sessionOf(threadId, adapter.child);
    detach(adapter);
    const turn = session?.turn ?? null;
    if (session !== undefined && turn !== null) {
      // a cancel first, so the agent can stop the tools it started; the kill below is the backstop
      // for an agent that will not answer it.
      await Promise.race([
        (async () => {
          try {
            await cancelPrompt(session, turn);
            await turn.settled;
          } catch {
            // an adapter that cannot take the cancel meets the kill below.
          }
        })(),
        adapter.gone,
        delay(SESSION_SHUTDOWN_GRACE_MS, null, { ref: false }),
      ]);
    }
    await kill(adapter);
  };

  const openAdapter = async (threadId: string, providerId: string): Promise<AcpAdapter> => {
    const harness = requireHarness(providerId);
    // a thread has one child: whatever it still holds goes first, so two adapters never write one
    // provider session's files.
    await closeThread(threadId);
    if (shuttingDown) {
      throw new Error("The agent runtime is shut down");
    }
    const { child } = spawnAdapter(harness, threadId);
    const { stdin, stdout } = child;
    if (stdin === null || stdout === null) {
      throw new Error(`The ${harness.displayName} adapter spawned without stdio pipes`);
    }
    const stdinWeb: WritableStream<Uint8Array> = Writable.toWeb(stdin);
    // Readable.toWeb types its stream any; the identity TransformStream stamps the chunk type
    // without an assertion. stdout's end does not close it: an ended stream closes the connection
    // with a bare "connection closed" before the exit below can name the crash.
    const identity = new TransformStream<Uint8Array, Uint8Array>();
    void (async () => {
      try {
        await Readable.toWeb(stdout).pipeTo(identity.writable, { preventClose: true });
      } catch {
        // a destroyed stdout is the child's exit path, which the close below reports.
      }
    })();
    const connection = connectClient(() => sessionOf(threadId, child), stdinWeb, identity.readable);
    const stderrTail: string[] = [];
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (line.trim() !== "") {
          stderrTail.push(line);
          if (stderrTail.length > STDERR_TAIL_LINES) {
            stderrTail.shift();
          }
          options.onStderr?.(line, threadId);
        }
      }
    });
    // oxlint-disable-next-line promise/avoid-new -- adapts the child's one-shot "exit" event
    const gone = new Promise<AdapterExit>((resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });
    void (async () => {
      const exit = await gone;
      if (child.stderr !== null) {
        await Promise.race([drained(child.stderr), delay(STDERR_DRAIN_MS, null, { ref: false })]);
      }
      connection.close(adapterExitError(harness, exit, stderrTail));
    })();
    const adapter: AcpAdapter = {
      child,
      closing: false,
      connection,
      gone,
      harness,
      providerId,
      threadId,
    };
    child.once("exit", () => {
      if (adapters.get(threadId) === adapter) {
        adapters.delete(threadId);
      }
      // an exit nobody asked for: a turn it was running fails through its prompt, and the next send
      // opens a new child.
      if (sessions.get(threadId)?.adapter === adapter) {
        sessions.delete(threadId);
      }
    });
    adapters.set(threadId, adapter);
    return adapter;
  };

  const requireSession = (threadId: string): AcpSession => {
    const session = sessions.get(threadId);
    if (session === undefined) {
      throw new Error(`No live provider session for thread "${threadId}"`);
    }
    return session;
  };

  const sessionMcpServers = async (): Promise<McpServer[]> => {
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
  };

  const newSession = async (adapter: AcpAdapter): Promise<ResumeThreadResult> => {
    const response = await adapter.connection.agent.request("session/new", {
      cwd: options.workspacePath,
      mcpServers: await sessionMcpServers(),
    });
    return { loaded: false, providerThreadId: response.sessionId };
  };

  // a refused session/new or session/load registers nothing and takes its child with it, so the
  // send after a sign-in opens a new adapter rather than prompting a session that never existed.
  const startSession = async (
    threadId: string,
    providerId: string,
    open: (
      adapter: AcpAdapter,
      capabilities: AgentCapabilities | undefined,
    ) => Promise<ResumeThreadResult>,
  ): Promise<ResumeThreadResult> => {
    const adapter = await openAdapter(threadId, providerId);
    try {
      const initialized = await adapter.connection.agent.request("initialize", {
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        protocolVersion: PROTOCOL_VERSION,
      });
      const opened = await open(adapter, initialized.agentCapabilities);
      if (adapter.closing) {
        throw new Error(
          `The ${adapter.harness.displayName} adapter was closed before its session opened`,
        );
      }
      sessions.set(threadId, {
        adapter,
        idleSinceMs: Date.now(),
        providerThreadId: opened.providerThreadId,
        turn: null,
      });
      return opened;
    } catch (error) {
      await destroyAdapter(adapter);
      throw error;
    }
  };

  const runPrompt = async (
    session: AcpSession,
    mapper: AcpTurnMapper,
    input: PromptInput[],
  ): Promise<void> => {
    const settle = (events: readonly ProviderEvent[]): void => {
      if (session.turn?.mapper !== mapper) {
        return;
      }
      session.turn = null;
      session.idleSinceMs = Date.now();
      if (!session.adapter.closing) {
        emit(events);
      }
    };
    try {
      const response = await session.adapter.connection.agent.request("session/prompt", {
        prompt: promptBlocks(input),
        sessionId: session.providerThreadId,
      });
      settle(mapper.completed(response.stopReason));
    } catch (error) {
      settle(mapper.failed(describeProviderError(error, session.adapter.harness)));
    }
  };

  const runtime: AgentRuntime = {
    async cancelTurn(threadId: string): Promise<void> {
      const session = sessions.get(threadId);
      const turn = session?.turn ?? null;
      if (session === undefined || turn === null || turn.cancel.signal.aborted) {
        return;
      }
      await cancelPrompt(session, turn);
    },

    closeThread,

    hasThread(threadId: string): boolean {
      return sessions.has(threadId);
    },

    async reapIdleProviderSessions(
      args: ReapIdleProviderSessionsArgs,
    ): Promise<ReapIdleProviderSessionsResult> {
      const reaped: ReapIdleProviderSessionsResult["reapedSessions"] = [];
      // snapshot: destroyAdapter mutates the map mid-iteration.
      const live = [...sessions.values()];
      for (const session of live) {
        if (session.turn !== null) {
          continue;
        }
        const idleForMs = args.nowMs - session.idleSinceMs;
        if (idleForMs < args.idleForMs) {
          continue;
        }
        await destroyAdapter(session.adapter);
        reaped.push({
          idleForMs,
          providerId: session.adapter.providerId,
          providerThreadId: session.providerThreadId,
          threadId: session.adapter.threadId,
        });
      }
      return { reapedSessions: reaped };
    },

    async resumeThread(args: ResumeThreadArgs): Promise<ResumeThreadResult> {
      const { providerThreadId } = args;
      return await startSession(args.threadId, args.providerId, async (adapter, capabilities) => {
        if (providerThreadId === undefined || capabilities?.loadSession !== true) {
          return await newSession(adapter);
        }
        try {
          await adapter.connection.agent.request("session/load", {
            cwd: options.workspacePath,
            mcpServers: await sessionMcpServers(),
            sessionId: providerThreadId,
          });
          return { loaded: true, providerThreadId };
        } catch (error) {
          options.onStderr?.(
            `session/load failed for thread "${args.threadId}" (${describeProviderError(error, adapter.harness)}); starting fresh`,
            args.threadId,
          );
          return await newSession(adapter);
        }
      });
    },

    async runTurn(args: RunTurnArgs): Promise<void> {
      const session = requireSession(args.threadId);
      if (session.turn !== null) {
        throw new Error(`Thread "${args.threadId}" already has an active turn`);
      }
      const mapper = new AcpTurnMapper({
        providerThreadId: session.providerThreadId,
        threadId: args.threadId,
        turnId: mintTurnId(),
      });
      emit(mapper.started());
      session.turn = {
        cancel: new AbortController(),
        mapper,
        settled: runPrompt(session, mapper, args.input),
      };
      // resolve once the prompt is on the wire, not when it settles: the send must return while the
      // turn streams.
      await Promise.resolve();
    },

    async shutdown(): Promise<void> {
      shuttingDown = true;
      await Promise.all(
        [...adapters.values()].map(async (adapter) => {
          await destroyAdapter(adapter);
        }),
      );
    },

    async startThread(args: StartThreadArgs): Promise<StartThreadResult> {
      const { providerThreadId } = await startSession(args.threadId, args.providerId, newSession);
      return { providerThreadId };
    },
  };

  return runtime;
};
