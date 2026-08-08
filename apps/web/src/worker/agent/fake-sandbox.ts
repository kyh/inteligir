// ---------------------------------------------------------------------------
// The scripted sandbox — an agent that needs no container, no Workers Paid
// plan, and no provider account.
//
// It exists so a whole agent flow can be driven deterministically and
// login-free. It scripts the CONTAINER and keeps everything else real — the
// runner, the transcript, the tool executor, the confirmation broker, the vault
// write-back and the event broadcast are the production ones, reached through
// the production report path. Only the process that would have produced the
// reports is fake.
//
// SO IT REPORTS LIKE ONE. Every report is serialized, bounded and handed to the
// sink with this container's own boot bearer — the same three steps the image's
// reporter takes before a POST, and the same entry the Worker's report route
// reaches after one. Nothing here is told which lane it is: the sink resolves
// that from the bearer, exactly as it does for a container that dialed in over
// HTTPS. A callback bound to a lane at wiring time would be the one fact this
// runtime never tested.
//
// The gap that remains is stated rather than hidden: the HTTP hop and pi. A
// scripted step is what a model would have said, not what one did.
//
// Selected by `AGENT_RUNTIME=scripted` (./provider-catalog). Production leaves
// it unset and never constructs this.
// ---------------------------------------------------------------------------

import type { FauxAgentScript } from "@repo/bridge/ipc-registry";
import {
  bytesToBase64,
  CONTAINER_REFUSAL,
  MAX_REPORT_BYTES,
  type AgentReport,
  type AgentReportReply,
  type VaultOp,
} from "@repo/agent-container/protocol";
import { readVaultReply } from "@repo/agent-container/vault-report";

import type {
  SandboxBoot,
  SandboxOutcome,
  SandboxPort,
  SandboxReportSink,
  SandboxState,
  SandboxTurn,
  SandboxVaultPush,
} from "./sandbox-port";

/** How the scripted container answers a turn nobody scripted: it echoes, so an
 * unscripted drive still produces a complete turn rather than a dead one. */
function echoStep(text: string): FauxAgentScript["steps"][number] {
  return { text: text === "" ? "[scripted] ok" : `[scripted] ${text}` };
}

export type FakeSandboxDeps = {
  /** The port's return direction — the entry an HTTP report reaches too. */
  readonly report: SandboxReportSink;
  /** Scheduled work the object must not be evicted before finishing. A turn is
   * dispatched and answered later, exactly as a real container's would be. */
  readonly defer: (work: Promise<unknown>) => void;
};

/**
 * The scripted container's whole state.
 *
 * Held per Durable Object instance rather than in module scope: one isolate
 * serves many tenants' objects, and a module-level script would be one user's
 * test driving another user's agent.
 */
export class FakeSandbox implements SandboxPort {
  private booted: SandboxBoot | null = null;
  private vaultRevision = 0;
  private seeded = false;
  private busy = false;
  private interrupted = false;
  /** The files the scripted container "holds" — kept so a test can assert what
   * materialization actually pushed, which is the half of the vault story the
   * report path does not cover. */
  private readonly files = new Map<string, Uint8Array>();
  private push: SandboxVaultPush | null = null;
  private script: FauxAgentScript["steps"] = [];
  /** Mid-turn messages waiting to fold into the running turn — pi's `steer` and
   * `follow_up`, which take no turn of their own. */
  private queued: SandboxTurn[] = [];
  private notice = "";

  constructor(private readonly deps: FakeSandboxDeps) {}

  /** Replace the queued turns. Empty steps restore the echo, so a drive can put
   * the default back without rebuilding the object. */
  setScript(script: FauxAgentScript): void {
    this.script = [...script.steps];
  }

  /** What the scripted container currently holds under `./vault`. */
  materialized(): ReadonlyMap<string, Uint8Array> {
    return this.files;
  }

  /** The last vault push it was handed. The files alone cannot show whether a
   * warm wake sent a delta or the whole manifest, and that difference is the
   * point of the change log. */
  lastPush(): SandboxVaultPush | null {
    return this.push;
  }

  /**
   * What the vault of record refused, as the model would have been told it.
   *
   * The image steers this sentence into the running pi session, because a
   * refusal nobody relays is a model that goes on building on a note the user
   * does not have. A scripted container has no model to tell, so it holds the
   * sentence where a drive can assert one was produced.
   */
  lastVaultNotice(): string {
    return this.notice;
  }

  state(): Promise<SandboxState> {
    if (this.booted === null) return Promise.resolve({ phase: "cold" });
    return Promise.resolve({
      phase: "ready",
      bootId: this.booted.bootId,
      vaultRevision: this.vaultRevision,
      seeded: this.seeded,
      busy: this.busy,
    });
  }

  boot(boot: SandboxBoot): Promise<SandboxOutcome> {
    this.booted = boot;
    // A boot is a fresh container: the scripted one loses its filesystem too,
    // because a fake that kept its files would hide every bug in the wake path.
    this.files.clear();
    this.push = null;
    this.vaultRevision = 0;
    this.seeded = false;
    return Promise.resolve({ ok: true });
  }

  materialize(push: SandboxVaultPush): Promise<SandboxOutcome> {
    if (this.booted === null) {
      return Promise.resolve({ ok: false, error: CONTAINER_REFUSAL.notBooted });
    }
    if (push.replaceAll) this.files.clear();
    for (const file of push.upserted) this.files.set(file.path, file.bytes);
    for (const path of push.removed) this.files.delete(path);
    this.vaultRevision = push.toRevision;
    this.push = push;
    return Promise.resolve({ ok: true });
  }

  dispatch(turn: SandboxTurn): Promise<SandboxOutcome> {
    if (this.booted === null) {
      return Promise.resolve({ ok: false, error: CONTAINER_REFUSAL.notBooted });
    }
    if (this.busy) {
      // The daemon's own rule: a steer or a follow-up folds into the loop that
      // is already running, and a second `user_message` is a second turn, of
      // which there is only ever one. The refusal comes from the contract both
      // halves read, so the user gets one sentence whichever container ran.
      if (turn.kind === "user_message") {
        return Promise.resolve({ ok: false, error: CONTAINER_REFUSAL.turnInFlight });
      }
      this.queued.push(turn);
      return Promise.resolve({ ok: true });
    }
    this.busy = true;
    this.interrupted = false;
    // The scripted session takes every prompt, so it holds the conversation
    // from this turn on — the same thing the image reads off pi's preflight.
    this.seeded = true;
    // Dispatch RETURNS; the turn runs after. That is the contract the real port
    // has to honour, so the fake honours it too — a fake that ran the turn
    // inline would let a caller await something production never awaits.
    this.deps.defer(this.runTurn(turn));
    return Promise.resolve({ ok: true });
  }

  interrupt(): Promise<SandboxOutcome> {
    this.interrupted = true;
    return Promise.resolve({ ok: true });
  }

  shutdown(): Promise<void> {
    this.booted = null;
    this.files.clear();
    this.push = null;
    this.busy = false;
    this.seeded = false;
    this.queued = [];
    return Promise.resolve();
  }

  /**
   * Run the turn, then report that it ended.
   *
   * `busy` clears BEFORE the `turn_end` report goes out, exactly as the real
   * daemon clears `activeTurn` before sending it. That ordering is load-bearing
   * rather than incidental: the host dispatches the next queued background task
   * from inside that very report, and a container still calling itself busy
   * while announcing that it is not would deadlock an event-driven queue on its
   * own completion notice.
   */
  private async runTurn(turn: SandboxTurn): Promise<void> {
    let failure: string | null = null;
    try {
      await this.emit(turn.turnId, [{ type: "agent_start" }]);
      // Everything mid-turn reports under the STARTING turn's id, because that
      // is the turn: a steer folds into the loop rather than opening one.
      let message: SandboxTurn | undefined = turn;
      while (message !== undefined) {
        await this.runStep(turn.turnId, message.text);
        if (this.interrupted) break;
        message = this.queued.shift();
      }
      await this.emit(turn.turnId, [{ type: "agent_end" }]);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    this.queued = [];
    this.busy = false;
    await this.send({ kind: "turn_end", turnId: turn.turnId, error: failure });
  }

  /** One scripted step: its tool calls, its file writes, then what it said. */
  private async runStep(turnId: string, text: string): Promise<void> {
    const step = this.script.shift() ?? echoStep(text);

    for (const call of step.toolCalls ?? []) {
      if (this.interrupted) return;
      const toolCallId = crypto.randomUUID();
      await this.emit(turnId, [
        { type: "tool_execution_start", toolCallId, toolName: call.name, args: call.arguments },
      ]);
      const reply = await this.send({
        kind: "tool",
        turnId,
        name: call.name,
        args: call.arguments,
      });
      const result =
        reply !== null && reply.kind === "tool" ? reply : { isError: true, text: "no tool result" };
      await this.emit(turnId, [
        {
          type: "tool_execution_end",
          toolCallId,
          isError: result.isError,
          // pi's own tool-result shape: content blocks under `content`, which
          // is where the parser reads a result's text from. A bare array parses
          // as a tool that answered with nothing.
          result: { content: [{ type: "text", text: result.text }] },
        },
      ]);
    }

    await this.reportWrites(step.writes ?? []);

    await this.emit(turnId, [
      { type: "message_start", message: { role: "assistant" } },
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: step.text ?? "" }] },
      },
    ]);
  }

  /**
   * The agent's own file writes, as the image's watcher reports them.
   *
   * The files land under `./vault` first, because that is what the agent's file
   * tools did and what makes them visible to the rest of the turn — and then
   * the object decides. Its answer is read with the image's own reader
   * (`readVaultReply`), so the revision this container may claim and the
   * sentence the model owes a refusal are computed once, for both runtimes.
   */
  private async reportWrites(writes: readonly { path: string; text: string }[]): Promise<void> {
    if (writes.length === 0) return;
    const ops: VaultOp[] = writes.map((write) => {
      const bytes = new TextEncoder().encode(write.text);
      this.files.set(write.path, bytes);
      return { op: "upsert", path: write.path, bytesBase64: bytesToBase64(bytes) };
    });
    const held = this.vaultRevision;
    const reply = await this.send({ kind: "vault", fromRevision: held, ops });
    const outcome = readVaultReply(held, ops, reply);
    this.vaultRevision = outcome.revision;
    this.notice = outcome.notice;
  }

  /**
   * Events go out in pi's RAW shape, not the app's.
   *
   * A real container forwards what pi emits untranslated — the Worker owns that
   * mapping (@repo/bridge/agent-event-parser), once, for both hosts. A fake
   * that emitted the parsed shape would skip the parser entirely and let a
   * change to pi's event vocabulary pass every test while breaking production.
   */
  private async emit(
    turnId: string,
    events: readonly ({ type: string } & Record<string, unknown>)[],
  ): Promise<void> {
    await this.send({ kind: "events", turnId, events: [...events] });
  }

  /**
   * Post one report — the in-process transport.
   *
   * Serialized and bounded before it is handed over, because that is what a
   * transport does: the HTTP route refuses an oversized body before an object
   * is woken, and this one refuses to hand one over. `null` is "it did not
   * land", the same value the image's reporter answers with, so the caller
   * decides what that means per kind rather than being told it succeeded.
   */
  private async send(report: AgentReport): Promise<AgentReportReply | null> {
    const booted = this.booted;
    if (booted === null) return null;
    const body = JSON.stringify(report);
    if (new TextEncoder().encode(body).byteLength > MAX_REPORT_BYTES) return null;
    // The BEARER, not a lane: this container proves which boot it is, and the
    // sink decides the rest.
    const answer = await this.deps.report(booted.reportToken, body);
    return answer.ok ? answer.reply : null;
  }
}
