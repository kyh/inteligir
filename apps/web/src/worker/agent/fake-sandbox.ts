// ---------------------------------------------------------------------------
// The scripted sandbox — an agent that needs no container, no Workers Paid
// plan, and no provider account.
//
// It is the cloud twin of the desktop's faux provider, and it exists for the
// same reason: a deterministic, login-free way to drive a whole agent flow. The
// desktop scripted the MODEL and kept everything else real. This scripts the
// CONTAINER and keeps everything else real, which is the same bargain one level
// out — the runner, the transcript, the tool executor, the confirmation broker,
// the vault write-back and the event broadcast are the production ones, reached
// through the production report path. Only the process that would have produced
// the reports is fake.
//
// That is deliberately not a mock universe. `report` here is the SAME function
// the Worker's report route calls after it verifies a container's bearer, so a
// test that drives a scripted turn drives every line of the real path except
// the HTTP hop and pi itself.
//
// Selected by `AGENT_RUNTIME=scripted` (./provider-catalog). Production leaves
// it unset and never constructs this.
// ---------------------------------------------------------------------------

import type { FauxAgentScript } from "@repo/bridge/ipc-registry";
import type { AgentReport, AgentReportReply } from "@repo/agent-container/protocol";

import type {
  SandboxBoot,
  SandboxOutcome,
  SandboxPort,
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
  /** The production report entry — the same one the Worker route calls. */
  readonly report: (report: AgentReport) => Promise<AgentReportReply>;
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
  private seededThrough = 0;
  private busy = false;
  private interrupted = false;
  /** The files the scripted container "holds" — kept so a test can assert what
   * materialization actually pushed, which is the half of the vault story the
   * report path does not cover. */
  private readonly files = new Map<string, Uint8Array>();
  private push: SandboxVaultPush | null = null;
  private script: FauxAgentScript["steps"] = [];

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

  state(): Promise<SandboxState> {
    if (this.booted === null) return Promise.resolve({ phase: "cold" });
    return Promise.resolve({
      phase: "ready",
      bootId: this.booted.bootId,
      vaultRevision: this.vaultRevision,
      seededThrough: this.seededThrough,
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
    this.seededThrough = 0;
    return Promise.resolve({ ok: true });
  }

  materialize(push: SandboxVaultPush): Promise<SandboxOutcome> {
    if (this.booted === null) return Promise.resolve({ ok: false, error: "sandbox is not booted" });
    if (push.replaceAll) this.files.clear();
    for (const file of push.upserted) this.files.set(file.path, file.bytes);
    for (const path of push.removed) this.files.delete(path);
    this.vaultRevision = push.toRevision;
    this.push = push;
    return Promise.resolve({ ok: true });
  }

  dispatch(turn: SandboxTurn): Promise<SandboxOutcome> {
    if (this.booted === null) return Promise.resolve({ ok: false, error: "sandbox is not booted" });
    // A real container queues a steer or a follow-up into the running turn; this
    // one has no turn loop to queue into, so it refuses every concurrent
    // dispatch. That is the one place the scripted container is NARROWER than a
    // real one — a test cannot drive mid-turn steering here.
    if (this.busy) return Promise.resolve({ ok: false, error: "a turn is already running" });
    this.busy = true;
    this.interrupted = false;
    this.seededThrough = Math.max(this.seededThrough, turn.seededThrough);
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
    return Promise.resolve();
  }

  private async runTurn(turn: SandboxTurn): Promise<void> {
    try {
      const step = this.script.shift() ?? echoStep(turn.text);
      await this.emit(turn.turnId, [{ type: "agent_start" }]);

      for (const call of step.toolCalls ?? []) {
        if (this.interrupted) break;
        const toolCallId = crypto.randomUUID();
        await this.emit(turn.turnId, [
          {
            type: "tool_execution_start",
            toolCallId,
            toolName: call.name,
            args: call.arguments,
          },
        ]);
        const reply = await this.deps.report({
          kind: "tool",
          turnId: turn.turnId,
          name: call.name,
          args: call.arguments,
        });
        const result = reply.kind === "tool" ? reply : { isError: true, text: "no tool result" };
        await this.emit(turn.turnId, [
          {
            type: "tool_execution_end",
            toolCallId,
            isError: result.isError,
            result: [{ type: "text", text: result.text }],
          },
        ]);
      }

      const text = step.text ?? "";
      await this.emit(turn.turnId, [
        { type: "message_start", message: { role: "assistant" } },
        {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text }] },
        },
      ]);
      await this.emit(turn.turnId, [{ type: "agent_end" }]);
      await this.deps.report({ kind: "turn_end", turnId: turn.turnId, error: null });
    } catch (error) {
      await this.deps.report({
        kind: "turn_end",
        turnId: turn.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.busy = false;
    }
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
    await this.deps.report({ kind: "events", turnId, events: [...events] });
  }
}
