// ---------------------------------------------------------------------------
// Where the agent's parts are put together — the one place that knows the whole
// shape, so `UserHost` does not have to.
//
// It also holds the runtime choice: a real Cloudflare Sandbox, or the scripted
// in-memory one. That is a single `if`, made once, on a var the deployment sets
// (`AGENT_RUNTIME`) — and everything downstream of it is identical, because the
// port is the same contract either way, in both directions (./sandbox-port).
//
// The scripted branch is not a test double bolted on the side. It is how this
// repo is developed: `@cloudflare/sandbox` needs the Workers Paid plan and a
// built image, and the entire test suite — plus anyone running `wrangler dev`
// without Docker — has neither. So the login-free path is a first-class runtime
// rather than a mock, chosen once here and identical downstream.
//
// TWO LANES ARE TWO CONTAINERS (see ./agent-runner's header for why the split
// has to be at the container). Everything else is shared and must be: one
// vault, one knowledge index, one snapshot store, one durable background lock.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import type { AgentConfirmationRequest } from "@repo/bridge/agent-actions";
import type { ListDelegationsResult } from "@repo/bridge/delegation";
import type { ListRoutinesResult } from "@repo/bridge/routines";

import {
  BackgroundRuns,
  type BackgroundOutcome,
  type BackgroundRun,
} from "../background/background-runs";
import { Delegations } from "../background/delegations";
import { Routines } from "../background/routines";
import type { UserKnowledge } from "../host/knowledge/user-knowledge";
import type { UserVault } from "../host/vault/user-vault";
import { AgentRunner, type AgentLane } from "./agent-runner";
import { AgentSnapshots, type CapturedEdit } from "./agent-snapshots";
import { ChatStore } from "./chat-store";
import { createCfSandboxPort } from "./cf-sandbox";
import { FakeSandbox } from "./fake-sandbox";
import { ProviderCredentials } from "./provider-credentials";
import { ProviderService } from "./provider-service";
import { sandboxRuntimeEnabled } from "./provider-catalog";
import type { SandboxPort } from "./sandbox-port";
import { VaultRevisions } from "./vault-revisions";
import type { DeletableDurableKv } from "../store/durable-kv";

export type AgentCompositionDeps = {
  readonly env: Env;
  readonly userId: string;
  readonly sql: SqlStorage;
  readonly kv: DeletableDurableKv;
  readonly bucket: R2Bucket;
  /** R2 key prefix for this user's blobs — the vault's own. */
  readonly prefix: string;
  readonly vault: UserVault;
  readonly knowledge: UserKnowledge;
  /** TODAY's daily-note path, resolved from the ui-state Settings → Notes
   * keys — a routine's `daily` target. */
  readonly dailyPath: (now: Date) => string;
  readonly emitAgentEvent: (event: AppAgentEvent) => void;
  readonly emitConfirmation: (request: AgentConfirmationRequest) => void;
  readonly emitDelegations: (result: ListDelegationsResult) => void;
  readonly emitDelegationStream: (id: string, text: string) => void;
  readonly emitRoutines: (result: ListRoutinesResult) => void;
  readonly emitEditCaptured: (capture: CapturedEdit) => void;
  readonly onBusyChanged: () => void;
  /** A deadline this host must wake for may have moved — a routine's schedule
   * was edited, or a background run took the lane and with it a lease. The
   * object re-derives its ONE alarm from every concern's `nextDueAt`. */
  readonly onDeadlineChanged: () => void;
  /** The origin this deployment is reached on when no public host is declared. */
  readonly publicOrigin: () => string;
  /** Work the object must not be evicted before finishing — `ctx.waitUntil`. */
  readonly defer: (work: Promise<unknown>) => void;
};

export type AgentComposition = {
  readonly runner: AgentRunner;
  readonly chat: ChatStore;
  readonly credentials: ProviderCredentials;
  /** The ONE resolution of which provider runs, and the selection behind it. */
  readonly providers: ProviderService;
  readonly revisions: VaultRevisions;
  readonly snapshots: AgentSnapshots;
  /** The shared background lane — the durable one-turn-at-a-time lock. */
  readonly runs: BackgroundRuns;
  readonly delegations: Delegations;
  readonly routines: Routines;
  /**
   * The background half of the host's ONE alarm: reclaim a lease that ran out,
   * fire every routine whose slot has passed, and drain both queues.
   *
   * Idempotent, which Cloudflare's at-least-once alarm delivery requires — a
   * reclaimed lease is gone the second time, a fired routine is no longer due,
   * and a pump on a busy lane does nothing.
   */
  readonly sweepBackground: (now: number) => Promise<void>;
  /**
   * Destroy both lanes' containers — the agent's half of an account purge.
   *
   * Both, because a lane IS a container (see the header): a purge that took
   * only the chat one would leave a running image holding a scratch copy of a
   * vault whose owner no longer exists. Idempotent, because the port's
   * `shutdown` treats an already-gone container as the state it was asked for.
   */
  readonly destroyContainers: () => Promise<void>;
  /** When this host must next wake for background work, or null. */
  readonly backgroundDueAt: (now: number) => number | null;
  /** A lane's scripted container, or `null` on the real runtime. */
  readonly scripted: (lane: AgentLane) => FakeSandbox | null;
};

export function composeAgent(deps: AgentCompositionDeps): AgentComposition {
  const chat = new ChatStore(deps.sql);
  const revisions = new VaultRevisions(deps.sql);
  const runs = new BackgroundRuns(deps.sql);
  const snapshots = new AgentSnapshots({
    sql: deps.sql,
    bucket: deps.bucket,
    prefix: deps.prefix,
    vault: {
      lookup: (path) => {
        const file = deps.vault.lookup(path);
        return file === null ? null : { state: file.state, key: file.key };
      },
      writeText: (path, content) => deps.vault.writeText(path, content),
      trash: (paths) => deps.vault.trash(paths),
    },
    onChatCaptured: deps.emitEditCaptured,
  });
  const credentials = new ProviderCredentials({
    kv: deps.kv,
    userId: deps.userId,
    secret: deps.env.BETTER_AUTH_SECRET,
    env: deps.env,
    // Bound rather than passed bare: `fetch` on workerd is an unbound global,
    // and a method-shaped reference to it throws on call.
    fetch: (input, init) => fetch(input, init),
  });
  const providers = new ProviderService({ env: deps.env, credentials });

  // The scripted containers are built EAGERLY (a few fields in memory each) so
  // `scripted` is a plain lookup rather than something a caller has to provoke
  // into existing. `report` is the PRODUCTION report sink, not a stub: a
  // scripted turn therefore drives the real transcript, the real tool executor
  // and the real confirmation broker, and only the process that would have
  // produced the reports is fake. NEITHER IS TOLD ITS LANE — each presents the
  // report bearer its own boot carried, and the sink resolves the lane from it,
  // which is the identical derivation a container dialing in over HTTPS gets.
  // The runner they report into is constructed just below, which is why the
  // reference is deferred.
  let runner: AgentRunner | null = null;
  const scriptedPort = (): FakeSandbox =>
    new FakeSandbox({
      report: (identity, body) => {
        if (runner === null) throw new Error("the agent runner is not composed yet");
        return runner.acceptReport(identity, body);
      },
      defer: deps.defer,
    });
  const scripted: Record<AgentLane, FakeSandbox> | null = sandboxRuntimeEnabled(deps.env)
    ? null
    : { chat: scriptedPort(), background: scriptedPort() };

  // A real container's stub is built once per lane and captured, so its state
  // survives between turns; the scripted ones already do.
  const cfPorts = new Map<AgentLane, SandboxPort>();
  const sandbox = (lane: AgentLane): SandboxPort => {
    if (scripted !== null) return scripted[lane];
    const existing = cfPorts.get(lane);
    if (existing !== undefined) return existing;
    const port = createCfSandboxPort({
      namespace: deps.env.AGENT_SANDBOX,
      // One container per user PER LANE, named after their host so a log line
      // about a container names the account and the lane it belongs to.
      name: lane === "chat" ? `user-${deps.userId}` : `user-${deps.userId}-background`,
    });
    cfPorts.set(lane, port);
    return port;
  };

  // The two owners of the background lane. Both are constructed before the
  // runner so it can hand the delegate tier a real port, and both dispatch
  // THROUGH the runner — which is why that edge is a lazy accessor rather than
  // a constructor argument.
  const dispatch = async (
    owner: Parameters<AgentRunner["runBackground"]>[0],
    ref: string,
    prepare: Parameters<AgentRunner["runBackground"]>[2],
  ) => {
    if (runner === null) throw new Error("the agent runner is not composed yet");
    const outcome = await runner.runBackground(owner, ref, prepare);
    // A claimed lane carries a lease the host must wake to reclaim — a
    // container that dies mid-turn never reports, so nothing else would.
    deps.onDeadlineChanged();
    return outcome;
  };
  // Not `runner?.providerRefusal() ?? …`: the runner answering NULL is the
  // whole point of asking, and `??` would read "nothing is wrong" as "the
  // runner is missing" and refuse every run.
  const refusalReason = (): string | null =>
    runner === null ? "The agent is not composed yet." : runner.providerRefusal();

  const delegations = new Delegations({
    sql: deps.sql,
    vault: { readText: (path) => deps.vault.readText(path) },
    snapshots,
    runs,
    dispatch,
    interrupt: async () => {
      await runner?.interruptBackground();
    },
    refusalReason,
    onChanged: deps.emitDelegations,
    onStreamed: deps.emitDelegationStream,
  });
  const routines = new Routines({
    sql: deps.sql,
    vault: {
      readOptional: async (path) => {
        const file = deps.vault.lookup(path);
        return file === null || file.state !== "live" ? null : deps.vault.readText(path);
      },
      writeText: (path, content) => deps.vault.writeText(path, content),
    },
    snapshots,
    runs,
    dispatch,
    dailyPath: deps.dailyPath,
    clock: () => new Date(),
    refusalReason,
    onChanged: deps.emitRoutines,
    onScheduleChanged: deps.onDeadlineChanged,
  });

  runner = new AgentRunner({
    env: deps.env,
    userId: deps.userId,
    kv: deps.kv,
    vault: deps.vault,
    knowledge: deps.knowledge,
    chat,
    snapshots,
    providers,
    revisions,
    runs,
    sandbox,
    delegations: () => delegations,
    publicOrigin: deps.publicOrigin,
    emitAgentEvent: deps.emitAgentEvent,
    emitConfirmation: deps.emitConfirmation,
    onBusyChanged: deps.onBusyChanged,
    onBackgroundStream: (run, transcript) => {
      if (run.owner === "delegation") delegations.stream(run, transcript);
    },
    // The lane is free again by the time this runs — and so is the container,
    // which clears its own busy flag before reporting the end (../agent/
    // fake-sandbox, container/src/main.ts). So each owner records its outcome
    // and then the queues drain, BOTH of them, because the one that gets the
    // lane next is whichever has work rather than whichever just released it.
    onBackgroundSettled: async (run: BackgroundRun, outcome: BackgroundOutcome) => {
      if (run.owner === "delegation") delegations.settle(run, outcome);
      else await routines.settle(run, outcome);
      await delegations.pump();
      await routines.pump();
      deps.onDeadlineChanged();
    },
  });

  return {
    runner,
    chat,
    credentials,
    providers,
    revisions,
    snapshots,
    runs,
    delegations,
    routines,
    sweepBackground: async (now) => {
      // A container that died mid-turn never reports `turn_end`, so the lease
      // is the only thing that can free the lane. Reclaimed FIRST, so the
      // queues below find it free.
      const expired = runs.expired(now);
      if (expired !== null) {
        runs.release(expired.turnId);
        const timedOut: BackgroundOutcome = { kind: "failed", error: "Timed out" };
        if (expired.owner === "delegation") delegations.settle(expired, timedOut);
        else await routines.settle(expired, timedOut);
      }
      // Delegation first: it is work someone asked for and is waiting on.
      await delegations.pump();
      await routines.tick();
    },
    destroyContainers: async () => {
      await Promise.all([sandbox("chat").shutdown(), sandbox("background").shutdown()]);
    },
    backgroundDueAt: (now) => {
      const due = [runs.nextDueAt(), routines.nextDueAt(now)].filter(
        (at): at is number => at !== null,
      );
      return due.length === 0 ? null : Math.min(...due);
    },
    scripted: (lane) => scripted?.[lane] ?? null,
  };
}
