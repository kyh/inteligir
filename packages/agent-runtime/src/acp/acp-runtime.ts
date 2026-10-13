// one adapter child per thread. ACP has no turn ids (a prompt's response is the turn's end) and no
// steering (a prompt owns its session until it settles), so a turn is the host's id over one prompt
// and a mid-turn message waits in the host's queue.

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { PROTOCOL_VERSION, client, ndJsonStream } from "@agentclientprotocol/sdk";
import type {
  AgentCapabilities,
  ClientCapabilities,
  ClientConnection,
  ContentBlock,
  NewSessionRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  Stream,
} from "@agentclientprotocol/sdk";
import type { HarnessId } from "@repo/domain/harness";
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
import { traceFrames } from "./frame-trace.js";
import { buildThreadShellEnvironment } from "../thread-shell-environment.js";
import { HARNESSES, VaultConfigRefusedError, harnessHostEnv } from "./harness-registry.js";
import type { HarnessDefinition, HarnessModels } from "./harness-registry.js";
import {
  TYPED_FAILURES_META,
  describeProviderError,
  readProviderError,
  readSessionFailure,
} from "./provider-error.js";

// how long an adapter gets to stop itself once its stdin ends, and a cancelled prompt to settle:
// both pinned adapters give their own child 2s after their stdin closes before they signal it.
const ADAPTER_STOP_GRACE_MS = 3000;
const SIGTERM_GRACE_MS = 2000;
// a caller must not hang on an exit that never arrives, even after a SIGKILL.
const SIGKILL_WAIT_MS = 1000;

// the longest `terminateAdapter` takes, so a host's shutdown budget can hold it whole.
export const ADAPTER_TEARDOWN_MS = ADAPTER_STOP_GRACE_MS + SIGTERM_GRACE_MS + SIGKILL_WAIT_MS;

// 'exit' can arrive before the child's last stderr chunk, and that chunk is usually what names the crash.
const STDERR_DRAIN_MS = 200;
const STDERR_TAIL_LINES = 20;

export interface AcpAgentRuntimeOptions extends AgentRuntimeOptions {
  models?: HarnessModels;
  // spawned detached, as `spawnNodeAdapter` does: the teardown kills the adapter's process group,
  // and only a group of its own holds what the adapter starts and nothing of the host's.
  spawnAdapter?:
    | ((
        harness: HarnessDefinition,
        env: Record<string, string>,
        cwd: string,
      ) => ChildProcessWithoutNullStreams)
    | undefined;
  // every frame traded with an adapter, as `traceFrames` redacts it; absent, nothing is tapped.
  debugLog?: ((line: string) => void) | undefined;
}

interface AdapterExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface AdapterSpawnEnvOptions {
  // the env the adapter inherits, less the harness's envOmit.
  hostEnv: NodeJS.ProcessEnv;
  // what the agent's shell inherits: it is how the server url and the cli's PATH reach `inteligir`.
  shellEnv?: AgentRuntimeShellEnvironment | undefined;
  // the thread the adapter serves; a sign-in serves none.
  threadId: string | null;
  model: string | null;
}

// one assembly for every adapter spawn, so a session and a sign-in cannot start the adapter on two
// different envs.
export const adapterSpawnEnv = (
  harness: HarnessDefinition,
  options: AdapterSpawnEnvOptions,
): AgentRuntimeShellEnvironment => {
  const env = harnessHostEnv(harness, options.hostEnv);
  Object.assign(
    env,
    options.threadId === null
      ? options.shellEnv
      : buildThreadShellEnvironment({ baseShellEnv: options.shellEnv, threadId: options.threadId }),
  );
  // a value the host already set wins: it names an install the user chose.
  for (const [key, value] of Object.entries(harness.adapterEnv)) {
    env[key] ??= value;
  }
  if (options.model !== null) {
    harness.applyModel(options.model, env);
  }
  return env;
};

// the adapter as node runs it, when the host names no spawn of its own.
export const spawnNodeAdapter = (
  harness: HarnessDefinition,
  env: Record<string, string>,
  cwd: string,
): ChildProcessWithoutNullStreams =>
  spawn(process.execPath, [harness.adapterEntry], {
    cwd,
    detached: true,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

const exitedWithin = async (gone: Promise<unknown>, ms: number): Promise<boolean> =>
  await Promise.race([
    (async () => {
      await gone;
      return true;
    })(),
    delay(ms, false, { ref: false }),
  ]);

// the whole group, even once the adapter itself has exited: codex-acp exits on SIGTERM without
// stopping its app-server, and a child of the adapter's outlives it in the group.
const killGroup = (child: ChildProcessWithoutNullStreams): void => {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // the group is already gone.
  }
};

// stdin's end first, on which both pinned adapters stop their own child and exit, where codex-acp's
// SIGTERM skips that. SIGTERM once the grace passes, then SIGKILL to the group.
export const terminateAdapter = async (
  child: ChildProcessWithoutNullStreams,
  gone: Promise<unknown>,
): Promise<void> => {
  child.stdin.end();
  if (!(await exitedWithin(gone, ADAPTER_STOP_GRACE_MS))) {
    child.kill("SIGTERM");
    await exitedWithin(gone, SIGTERM_GRACE_MS);
  }
  killGroup(child);
  await exitedWithin(gone, SIGKILL_WAIT_MS);
};

// one spawned child, from spawn to exit. the connection closes with the child's exit, so every
// request still pending rejects naming the harness, the exit status and the last stderr lines.
interface AcpAdapter {
  threadId: string;
  harness: HarnessDefinition;
  child: ChildProcessWithoutNullStreams;
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

export interface AdapterChannel {
  // the child's stdin and stdout as one ACP stream.
  stream: Stream;
  gone: Promise<AdapterExit>;
  // the exit, once its last stderr is in, as the error that names both: the connection closes with
  // it, so every request still pending rejects saying why rather than "connection closed".
  exited: Promise<Error>;
}

export const openAdapterChannel = (
  harness: HarnessDefinition,
  child: ChildProcessWithoutNullStreams,
  onStderrLine?: (line: string) => void,
): AdapterChannel => {
  const stdinWeb: WritableStream<Uint8Array> = Writable.toWeb(child.stdin);
  // Readable.toWeb types its stream any; the identity TransformStream stamps the chunk type
  // without an assertion. stdout's end does not close it: an ended stream closes the connection
  // with a bare "connection closed" before the exit can name the crash.
  const identity = new TransformStream<Uint8Array, Uint8Array>();
  void (async () => {
    try {
      await Readable.toWeb(child.stdout).pipeTo(identity.writable, { preventClose: true });
    } catch {
      // a destroyed stdout is the child's exit path, which `exited` reports.
    }
  })();
  const stderrTail: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf-8").split("\n")) {
      if (line.trim() !== "") {
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) {
          stderrTail.shift();
        }
        onStderrLine?.(line);
      }
    }
  });
  // oxlint-disable-next-line promise/avoid-new -- adapts the child's one-shot "exit" event
  const gone = new Promise<AdapterExit>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  const exited = (async () => {
    const exit = await gone;
    await Promise.race([drained(child.stderr), delay(STDERR_DRAIN_MS, null, { ref: false })]);
    return adapterExitError(harness, exit, stderrTail);
  })();
  return { exited, gone, stream: ndJsonStream(stdinWeb, identity.readable) };
};

// the host closed the thread while its adapter was still being opened.
export class ThreadClosedError extends Error {
  constructor(threadId: string) {
    super(`Thread "${threadId}" was closed before its adapter opened`);
    this.name = "ThreadClosedError";
  }
}

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
  // bumped by every host close. a close landing while an open awaits the previous child's exit has
  // no new child to stop yet, so the open checks this before it spawns one.
  const closeGenerations = new Map<string, number>();
  let shuttingDown = false;

  const emit = (events: readonly ProviderEvent[]): void => {
    for (const event of events) {
      options.onEvent(event);
    }
  };

  const sessionOf = (
    threadId: string,
    child: ChildProcessWithoutNullStreams,
  ): AcpSession | undefined => {
    const session = sessions.get(threadId);
    return session?.adapter.child === child ? session : undefined;
  };

  const spawnAdapter = (
    harness: HarnessDefinition,
    threadId: string,
  ): ChildProcessWithoutNullStreams => {
    const env = adapterSpawnEnv(harness, {
      hostEnv: process.env,
      model: options.models?.[harness.id] ?? null,
      shellEnv: options.shellEnv?.(),
      threadId,
    });
    return (options.spawnAdapter ?? spawnNodeAdapter)(harness, env, options.workspacePath);
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
          providerRequestId: params.toolCall.toolCallId,
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
      options.onActivity?.(current.adapter.threadId);
      emit(current.turn.mapper.update(params));
    }
  };

  const connectClient = (
    threadId: string,
    session: () => AcpSession | undefined,
    stream: Stream,
  ): ClientConnection => {
    const { debugLog } = options;
    return client({ name: "inteligir" })
      .onRequest(
        "session/request_permission",
        async ({ params }) => await requestPermission(session(), params),
      )
      .onNotification("session/update", ({ params }) => {
        sessionUpdate(session(), params);
      })
      .connect(
        debugLog === undefined
          ? stream
          : traceFrames(stream, (line) => {
              debugLog(`thread ${threadId} ${line}`);
            }),
      );
  };

  // the runtime is ending this child itself, so it stops answering to the host at once.
  const detach = (adapter: AcpAdapter): void => {
    adapter.closing = true;
    if (sessions.get(adapter.threadId)?.adapter === adapter) {
      sessions.delete(adapter.threadId);
    }
  };

  const kill = async (adapter: AcpAdapter): Promise<void> => {
    await terminateAdapter(adapter.child, adapter.gone);
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

  const closeAdapter = async (threadId: string): Promise<void> => {
    const adapter = adapters.get(threadId);
    if (adapter === undefined) {
      return;
    }
    const session = sessionOf(threadId, adapter.child);
    detach(adapter);
    const turn = session?.turn ?? null;
    if (session !== undefined && turn !== null) {
      // a cancel first, so the agent can stop the tools it started; the teardown below is the
      // backstop for an agent that will not answer it.
      await Promise.race([
        (async () => {
          try {
            await cancelPrompt(session, turn);
            await turn.settled;
          } catch {
            // an adapter that cannot take the cancel meets the teardown below.
          }
        })(),
        adapter.gone,
        delay(ADAPTER_STOP_GRACE_MS, null, { ref: false }),
      ]);
    }
    await kill(adapter);
  };

  const closeGeneration = (threadId: string): number => closeGenerations.get(threadId) ?? 0;

  const closeThread = async (threadId: string): Promise<void> => {
    closeGenerations.set(threadId, closeGeneration(threadId) + 1);
    await closeAdapter(threadId);
  };

  const openAdapter = async (threadId: string, providerId: HarnessId): Promise<AcpAdapter> => {
    const harness = HARNESSES[providerId];
    const generation = closeGeneration(threadId);
    // a thread has one child: whatever it still holds goes first, so two adapters never write one
    // provider session's files.
    await closeAdapter(threadId);
    if (shuttingDown) {
      throw new Error("The agent runtime is shut down");
    }
    if (closeGeneration(threadId) !== generation) {
      throw new ThreadClosedError(threadId);
    }
    const child = spawnAdapter(harness, threadId);
    const channel = openAdapterChannel(harness, child, (line) => {
      options.onStderr?.(line, threadId);
    });
    const connection = connectClient(threadId, () => sessionOf(threadId, child), channel.stream);
    void (async () => {
      connection.close(await channel.exited);
    })();
    const adapter: AcpAdapter = {
      child,
      closing: false,
      connection,
      gone: channel.gone,
      harness,
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

  // one shape for session/new and session/load: a resumed session must not open with less.
  const sessionOpen = (harness: HarnessDefinition): NewSessionRequest => {
    const refused = harness.refusedVaultEntries.find((entry) =>
      existsSync(path.join(options.workspacePath, entry)),
    );
    if (refused !== undefined) {
      throw new VaultConfigRefusedError(harness, refused);
    }
    const open: NewSessionRequest = {
      cwd: options.workspacePath,
      // ACP requires the field, and it stays empty so each vendor loads the servers its own user
      // config names: one store, the vendor's, rather than a second list beside it.
      mcpServers: [],
    };
    if (harness.sessionMeta !== null) {
      // spread: ACP types `_meta` as an open record, which an interface does not satisfy.
      open._meta = { ...harness.sessionMeta };
    }
    return open;
  };

  const newSession = async (adapter: AcpAdapter): Promise<ResumeThreadResult> => {
    const response = await adapter.connection.agent.request(
      "session/new",
      sessionOpen(adapter.harness),
    );
    return { loaded: false, providerThreadId: response.sessionId };
  };

  // a refused session/new or session/load registers nothing and takes its child with it, so the
  // send after a sign-in opens a new adapter rather than prompting a session that never existed.
  const startSession = async (
    threadId: string,
    providerId: HarnessId,
    open: (
      adapter: AcpAdapter,
      capabilities: AgentCapabilities | undefined,
    ) => Promise<ResumeThreadResult>,
  ): Promise<ResumeThreadResult> => {
    const adapter = await openAdapter(threadId, providerId);
    try {
      const clientCapabilities: ClientCapabilities = {
        fs: { readTextFile: false, writeTextFile: false },
      };
      if (adapter.harness.typedFailures) {
        clientCapabilities._meta = TYPED_FAILURES_META;
      }
      const initialized = await adapter.connection.agent.request("initialize", {
        clientCapabilities,
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
      const failure = readSessionFailure(response._meta);
      settle(
        failure === null
          ? mapper.completed(response.stopReason)
          : mapper.failed(failure.adapterMessage, failure.failure),
      );
    } catch (error) {
      const reading = readProviderError(error);
      settle(mapper.failed(reading.adapterMessage, reading.failure));
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
          providerId: session.adapter.harness.id,
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
            ...sessionOpen(adapter.harness),
            sessionId: providerThreadId,
          });
          return { loaded: true, providerThreadId };
        } catch (error) {
          options.onStderr?.(
            `session/load failed for thread "${args.threadId}" (${describeProviderError(error)}); starting fresh`,
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
      const mapper = new AcpTurnMapper({ threadId: args.threadId, turnId: args.turnId });
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
