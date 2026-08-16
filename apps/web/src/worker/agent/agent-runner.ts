// ---------------------------------------------------------------------------
// The agent's turn lifecycle, inside the user's own Durable Object.
//
// THE RULE THIS MODULE ENFORCES: a Durable Object never awaits a turn. A
// delegation or a routine runs for up to ten minutes, and an object that waited
// on one would hold an invocation open for the whole of it — with the user's
// sockets, their vault manifest and their knowledge index behind it. So `send`
// resolves as soon as the container has ACCEPTED the turn, and everything the
// turn produces arrives later, through the port's return direction
// (`acceptReport`) — one entry, whichever transport carried it.
//
// So the agent is never an in-process object whose events arrive on a callback.
// The sequence is:
//
//     send   → wake the container if it is cold, push the vault, dispatch
//     report → events fold into the transcript and broadcast to sockets
//     report → a tool call runs host-side and answers
//     report → the agent's file writes land in the vault of record
//     report → the turn ends
//
// EVERY WAKE IS A COLD START. The container's filesystem is deleted when it
// sleeps, which for an agent nobody is talking to is most of the time. So
// `ensureContainer` is not a first-run path — it is the ordinary one, and the
// code says so rather than treating it as recovery.
//
// TWO LANES, TWO CONTAINERS. Unattended work — delegation, routines — is
// isolated from the conversation so that neither can see the other, and the
// isolation unit has to be the CONTAINER rather than a second pi session inside
// one. The reason is the vault: the container reports the agent's
// file writes from a filesystem WATCHER, which cannot say which session wrote a
// file. Two sessions sharing one `./vault` would make every agent write
// ambiguous between an attended edit the chat toast can undo and an unattended
// one the delegation dock owns. Two containers make the lane a fact of the
// CREDENTIAL instead: each boots with its own report bearer, and `acceptReport`
// resolves the lane from the token rather than from anything the caller says.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import { parseAgentEvent } from "@repo/bridge/agent-event-parser";
import type { AgentConfirmationRequest } from "@repo/bridge/agent-actions";
import type { TextChatMessage } from "@repo/bridge/chat-message";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import {
  AgentReportSchema,
  base64ToBytes,
  type AgentReport,
  type AgentReportReply,
  type VaultOp,
} from "@repo/agent-container/protocol";
import { Value } from "@sinclair/typebox/value";

import type {
  BackgroundDispatchOutcome,
  BackgroundOutcome,
  BackgroundOwner,
  BackgroundPrepared,
  BackgroundRun,
  BackgroundRuns,
} from "../background/background-runs";
import type { UserKnowledge } from "../host/knowledge/user-knowledge";
import type { UserVault } from "../host/vault/user-vault";
import { mintScopedToken, verifyScopedToken } from "./agent-crypto";
import { composeInstructions, instructionsDependOn } from "./agent-instructions";
import type { AgentSnapshots, SnapshotScope } from "./agent-snapshots";
import { agentToolManifest, executeAgentTool, type DelegationToolPort } from "./agent-tools";
import type { ChatStore } from "./chat-store";
import { ConfirmationBroker } from "./confirmations";
import { sandboxRuntimeEnabled } from "./provider-catalog";
import type { ProviderService, TurnProvider } from "./provider-service";
import type {
  SandboxBootPins,
  SandboxPort,
  SandboxReportAnswer,
  SandboxSeedTurn,
  SandboxVaultFile,
  SandboxVaultPush,
} from "./sandbox-port";
import type { VaultRevisions } from "./vault-revisions";
import { sha256Hex } from "../hash";
import type { DurableKv } from "../store/durable-kv";

/**
 * Which container a turn belongs to.
 *
 * `chat` is the conversation the user is in. `background` is the unattended
 * lane delegation and routines share — a separate container, so its turns can
 * neither read the conversation nor have their file writes confused with it.
 */
export type AgentLane = "chat" | "background";

/** How long a container's report bearer stays valid. It is bounded by the boot
 * it names as well, so this is the outer limit on a token that leaked from a
 * container that then kept running. */
const REPORT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** Files read from R2 per materialization pass. R2 round trips dominate, and
 * issuing them one at a time makes a wake linear in latency rather than work. */
const MATERIALIZE_BATCH = 25;

/** Files one wake will push. Past this the vault is too large to hand a
 * container in one invocation, and the push is refused with a sentence rather
 * than half-completing. */
const MAX_MATERIALIZED_FILES = 5_000;

/** Per lane, so a token minted for one container is refused by the other's
 * check — the same one-primitive-two-uses rule the scoped token's `scope`
 * field keeps (./agent-crypto). */
const BOOT_KEY: Record<AgentLane, string> = {
  chat: "agent/boot",
  background: "agent/boot/background",
};

/**
 * What this object handed the container it believes is running — its identity,
 * and a digest of every PINNED fact that identity was booted with.
 *
 * The digest is the second half of the warm predicate, and the reason it is
 * durable rather than derived from the container's own answer is that these are
 * facts the OBJECT decided: which provider a turn runs on, which model, where
 * reports go. A container asked to confirm them could only echo what it was
 * told, so the comparison would be with itself.
 */
type StoredBoot = {
  readonly id: string;
  readonly pins: string;
};

/**
 * The chat turn whose reports this object is listening for — the conversation's
 * counterpart of the background lane's lock row.
 *
 * DURABLE, not a field: the reports that answer a turn arrive as separate
 * requests and the object hibernates between them, so an in-memory copy reads
 * as absent exactly when a report needs it. Without it a container on the
 * current boot can announce `turn_end` for a turn that is long over and clear
 * `busy` under the one now running.
 *
 * It holds what the CONTAINER said the turn is, never what this side hoped it
 * would be; `""` means there is nothing to disagree with, which is both the
 * never-dispatched state and the one a dispatch in flight leaves behind.
 */
const CHAT_TURN_KEY = "agent/chat-turn";

/**
 * Cloudflare Browser Run's CDP endpoint, or `null` when this deployment has no
 * Browser Run account.
 *
 * `keep_alive` is what stops the remote browser closing between two tool calls
 * in one turn; ten minutes matches the container's own idle window, so the
 * browser and the container go away together.
 */
function browserRun(env: Env): { cdpUrl: string; token: string } | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.BROWSER_RUN_API_TOKEN;
  if (accountId === undefined || token === undefined || accountId === "" || token === "") {
    return null;
  }
  return {
    cdpUrl:
      `wss://api.cloudflare.com/client/v4/accounts/${accountId}` +
      `/browser-rendering/devtools/browser?keep_alive=600000`,
    token,
  };
}

export type AgentRunnerDeps = {
  readonly env: Env;
  readonly userId: string;
  readonly kv: DurableKv;
  readonly vault: UserVault;
  readonly knowledge: UserKnowledge;
  readonly chat: ChatStore;
  readonly snapshots: AgentSnapshots;
  readonly providers: ProviderService;
  readonly revisions: VaultRevisions;
  /** The shared background lane — the durable one-turn-at-a-time lock. */
  readonly runs: BackgroundRuns;
  /** Built lazily so a host that never chats never constructs a sandbox stub. */
  readonly sandbox: (lane: AgentLane) => SandboxPort;
  /** The delegation surface the `delegate` tier reaches. Resolved lazily: the
   * delegation store dispatches THROUGH this runner, so one of the two has to
   * be named before it exists. */
  readonly delegations: () => DelegationToolPort;
  /** The origin this deployment is reached on, when no public host is
   * declared — the last authenticated socket's, or "". */
  readonly publicOrigin: () => string;
  /** Push one agent event to this user's sockets. */
  readonly emitAgentEvent: (event: AppAgentEvent) => void;
  /** Raise a destructive proposal on this user's sockets. */
  readonly emitConfirmation: (request: AgentConfirmationRequest) => void;
  /** Announce that the agent's busy state changed, so `getAppState` consumers
   * re-render. */
  readonly onBusyChanged: () => void;
  /** A background run's transcript grew. */
  readonly onBackgroundStream: (run: BackgroundRun, transcript: string) => void;
  /** A background run ended — the owning surface records the outcome. */
  readonly onBackgroundSettled: (run: BackgroundRun, outcome: BackgroundOutcome) => Promise<void>;
};

export class AgentRunner {
  private readonly deps: AgentRunnerDeps;
  private readonly confirmations: ConfirmationBroker;

  /**
   * Whether a CHAT turn is in flight, as far as this object knows.
   *
   * In memory, and that is correct rather than a compromise: a turn is only
   * ever in flight while the container holds it, and the container's own
   * `state()` is the authority the runner consults before dispatching. This
   * field exists to answer `getAppState` between reports, and an object that
   * was evicted mid-turn answering "idle" is exactly right — it has no reason
   * to believe otherwise until the next report arrives. The background lane is
   * deliberately absent from it: an unattended task must not make the composer
   * look busy.
   */
  private busy = false;

  constructor(deps: AgentRunnerDeps) {
    this.deps = deps;
    this.confirmations = new ConfirmationBroker((request) => {
      deps.emitConfirmation(request);
    });
  }

  // ---- reads ----------------------------------------------------------------

  agentBusy(): boolean {
    return this.busy;
  }

  /** The instructions the live session was built with — the composed system
   * prompt, as far as this host owns one. */
  systemPrompt(): Promise<string> {
    return composeInstructions(this.deps.vault);
  }

  // ---- the outbound half ----------------------------------------------------

  /**
   * Accept one chat command.
   *
   * Rejects with a sentence rather than a code: `sendAgentCommand` is invoked
   * from a composer that surfaces the failure inline, so "connect a provider in
   * Settings" has to be readable as-is.
   */
  async send(command: TextChatMessage): Promise<void> {
    if (command.type === "interrupt") {
      const outcome = await this.deps.sandbox("chat").interrupt();
      if (!outcome.ok) throw new Error(outcome.error);
      return;
    }

    // ONE resolution per message, threaded into the boot below: the facts the
    // container is configured with are the facts this turn was admitted on.
    const resolved = this.deps.providers.turnFacts();
    if (!resolved.ok) throw new Error(resolved.error);
    const provider = resolved.provider;

    // The message is recorded LAST, once a container has accepted it. Anything
    // that fails before then — a cold container that will not start, a vault
    // too large to hand over, a dispatch the container refused — leaves the
    // transcript untouched, so a retry sends the message once rather than
    // twice. The composer's optimistic bubble is what tells the user it did
    // not go.
    const port = this.deps.sandbox("chat");
    // The thread this message belongs to, resolved BEFORE the container is
    // brought up: it is what decides whether the live session is holding this
    // conversation or one the user has since discarded.
    const conversation = this.deps.chat.activeSessionId();
    const seed = await this.ensureContainer("chat", port, provider, conversation);
    if (!seed.ok) throw new Error(seed.error);

    const previous = this.chatTurnId();
    // A dispatch in flight tracks NOTHING, and `""` is exactly that value: this
    // object has no turn to disagree with yet. Which turn will carry the
    // reports is the container's answer and it has not given it — a steer folds
    // into the turn already running and reports under ITS id, while one that
    // lands after that turn ended opens a turn of its own. The container can
    // report from inside the dispatch, so this window has to admit whichever it
    // turns out to be: honouring one extra report for the length of one call is
    // nothing beside swallowing a whole turn's answer, which is what tracking
    // the wrong guess here does.
    this.deps.kv.put(CHAT_TURN_KEY, "");
    const outcome = await port.dispatch({
      turnId: crypto.randomUUID(),
      conversation,
      kind: command.type,
      text: command.text,
      images: command.images ?? [],
      seed: seed.seed,
    });
    if (!outcome.ok) {
      this.deps.kv.put(CHAT_TURN_KEY, previous);
      throw new Error(outcome.error);
    }
    // The container SAID which turn carries this message; nothing here
    // re-derives it.
    this.deps.kv.put(CHAT_TURN_KEY, outcome.turnId);
    this.deps.chat.appendUser(command.text);
    this.setBusy(true);
  }

  /** The chat turn this object last dispatched, or `""` when it has never
   * dispatched one. */
  chatTurnId(): string {
    const stored = this.deps.kv.get(CHAT_TURN_KEY);
    return typeof stored === "string" ? stored : "";
  }

  /**
   * Take the background lane and hand it one unattended turn.
   *
   * The ORDER is the contract both owners depend on: claim, then resolve and
   * capture inside `prepare`, then dispatch — so nothing else can start a turn
   * while a checkbox is being re-resolved, and any failure between the claim
   * and the dispatch releases the lane rather than stranding it.
   */
  async runBackground(
    owner: BackgroundOwner,
    ref: string,
    prepare: (run: BackgroundRun) => Promise<BackgroundPrepared>,
  ): Promise<BackgroundDispatchOutcome> {
    const resolved = this.deps.providers.turnFacts();
    if (!resolved.ok) return { ok: false, reason: "refused", error: resolved.error };
    const provider = resolved.provider;
    const run = this.deps.runs.claim(owner, ref, Date.now());
    if (run === null) return { ok: false, reason: "busy" };

    const refuse = (error: string): BackgroundDispatchOutcome => {
      this.deps.runs.release(run.turnId);
      return { ok: false, reason: "refused", error };
    };
    try {
      const prepared = await prepare(run);
      if (!prepared.ok) return refuse(prepared.error);
      const port = this.deps.sandbox("background");
      // An unattended task IS its own conversation, of one turn. Naming the run
      // is what makes the next task a different one: the lane's container
      // outlives a run, and a session left holding the last task's messages
      // would show them to the next task, which shares nothing with it but a
      // container.
      const ready = await this.ensureContainer("background", port, provider, run.turnId);
      if (!ready.ok) return refuse(ready.error);
      const dispatched = await port.dispatch({
        turnId: run.turnId,
        conversation: run.turnId,
        kind: "user_message",
        text: prepared.prompt,
        images: [],
        // No prior turns, which is the whole point of the second container.
        seed: [],
      });
      if (!dispatched.ok) return refuse(dispatched.error);
      return { ok: true, run };
    } catch (error) {
      return refuse(toErrorMessage(error));
    }
  }

  /** Ask the background container's in-flight turn to stop. */
  async interruptBackground(): Promise<void> {
    await this.deps.sandbox("background").interrupt();
  }

  /**
   * Roll a fresh thread.
   *
   * Nothing is said to the container HERE, and that is deliberate rather than
   * an omission: the container is asleep most of the time, and a verb pushed at
   * one from a UI action would be a wake nobody asked for. What makes the new
   * thread fresh to the model is that the next turn names it — the live session
   * is then holding a conversation that turn does not belong to, and
   * `ensureContainer` replaces the session before dispatching.
   */
  newSession(): string {
    return this.deps.chat.newSession();
  }

  /** The human's answer to a destructive proposal. */
  resolveConfirmation(id: string, confirmed: boolean): void {
    this.confirmations.resolve(id, confirmed);
  }

  /** Decline everything pending — a torn-down object must not leave a tool call
   * waiting on a dialog nobody can see. */
  close(): void {
    this.confirmations.close();
  }

  // ---- the inbound half -----------------------------------------------------

  /**
   * The ONE way in for everything a container says — `SandboxReportSink`.
   *
   * Both transports arrive here: the Worker's report route after it has bounded
   * the body and addressed this object, and the scripted container in process.
   * Neither carries a verdict, and neither states a lane. Everything is decided
   * from the bearer and the bytes:
   *
   *   1. the bearer names an account and a BOOT, and the boot names the lane —
   *      the credential decides whose undo surface owns the writes, so a
   *      container cannot claim the other one's;
   *   2. the body is parsed and schema-checked before any of it becomes a
   *      transcript entry, a broadcast or a vault write.
   *
   * The identity is checked BEFORE the body is looked at: a caller who cannot
   * prove which container it is has nothing to say, and a parse error is not
   * something to tell them about.
   */
  async acceptReport(identity: string, body: string): Promise<SandboxReportAnswer> {
    const lane = await this.resolveReportLane(identity);
    if (lane === null) return { ok: false, status: 401, error: "unauthorized" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, status: 400, error: "malformed report" };
    }
    if (!Value.Check(AgentReportSchema, parsed)) {
      const first = Value.Errors(AgentReportSchema, parsed).First();
      return {
        ok: false,
        status: 400,
        error: `malformed report — ${first?.message ?? "shape mismatch"}`,
      };
    }
    return { ok: true, reply: await this.report(parsed, lane) };
  }

  /**
   * One verified report, on its lane — where it BECOMES something: a transcript
   * entry, a broadcast, a vault write, a tool result.
   */
  private report(report: AgentReport, lane: AgentLane): Promise<AgentReportReply> {
    return lane === "background" ? this.reportBackground(report) : this.reportChat(report);
  }

  /**
   * One report from the CHAT container.
   *
   * A report whose turn is not the one this object last dispatched folds into
   * NOTHING — the same rule the unattended lane gets from `runs.runAt`. The
   * container outlives a turn, so a `turn_end` for a turn that is long over
   * would otherwise clear `busy` under the one now running, and a message from
   * it would land in the conversation as though it had just been said.
   *
   * A `vault` report carries no turn and is not gated by one: the writes are
   * the agent's, whichever turn made them, and refusing them would strand work
   * the user can no longer recover.
   */
  private async reportChat(report: AgentReport): Promise<AgentReportReply> {
    const scope: SnapshotScope = { origin: "chat", ref: this.deps.chat.activeSessionId() };
    if (report.kind !== "vault" && !this.isCurrentChatTurn(report.turnId)) {
      return report.kind === "tool"
        ? { kind: "tool", isError: true, text: "That turn is over; this host is running another." }
        : { kind: "ack" };
    }
    switch (report.kind) {
      case "events":
        for (const raw of report.events) {
          const parsed = parseAgentEvent(raw);
          if (parsed !== null) this.applyChatEvent(parsed);
        }
        return { kind: "ack" };
      case "tool": {
        const result = await executeAgentTool(
          this.toolContext(scope, report.turnId, true),
          report.name,
          report.args,
        );
        return { kind: "tool", isError: result.isError, text: result.text };
      }
      case "vault":
        return this.applyVaultOps(report, scope);
      case "turn_end":
        this.setBusy(false);
        if (report.error !== null) {
          this.applyChatEvent({ type: "turn_error", kind: "unknown", reason: report.error });
        }
        return { kind: "ack" };
    }
  }

  /**
   * One report from the UNATTENDED container.
   *
   * Nothing here touches the chat transcript or broadcasts an agent event: a
   * routine firing at 09:00 is not a message in the user's conversation. What
   * it does instead is accumulate the run's live transcript (which the inline
   * badge renders) and settle the run when the turn ends.
   *
   * A report whose turn no longer holds the lane folds into NOTHING. A
   * container whose lease was reclaimed mid-turn keeps reporting, and applying
   * its writes to whatever run started since would attribute one task's edits
   * to another's undo point.
   */
  private async reportBackground(report: AgentReport): Promise<AgentReportReply> {
    if (report.kind === "vault") {
      const holder = this.deps.runs.holder();
      if (holder === null) {
        return {
          // Nothing was applied, so the container's own baseline is still the
          // most it may claim to hold.
          kind: "vault",
          revision: report.fromRevision,
          rejected: report.ops.map(
            (op) => `${op.path}: no background task is running, so nothing was written`,
          ),
        };
      }
      return this.applyVaultOps(report, { origin: holder.owner, ref: holder.ref });
    }

    const run = this.deps.runs.runAt(report.turnId);
    if (run === null) {
      return report.kind === "tool"
        ? { kind: "tool", isError: true, text: "This background task is no longer running." }
        : { kind: "ack" };
    }

    switch (report.kind) {
      case "events":
        for (const raw of report.events) {
          const parsed = parseAgentEvent(raw);
          if (parsed !== null) this.applyBackgroundEvent(run, parsed);
        }
        return { kind: "ack" };
      case "tool": {
        const result = await executeAgentTool(
          this.toolContext({ origin: run.owner, ref: run.ref }, run.turnId, false),
          report.name,
          report.args,
        );
        return { kind: "tool", isError: result.isError, text: result.text };
      }
      case "turn_end": {
        // Re-read: the run carries everything the events wrote to it, and the
        // release below is what frees the lane for the next queued task.
        const settled = this.deps.runs.runAt(report.turnId) ?? run;
        this.deps.runs.release(settled.turnId);
        await this.deps.onBackgroundSettled(settled, backgroundOutcome(settled, report.error));
        return { kind: "ack" };
      }
    }
  }

  /**
   * Verify a container's bearer against this object's own name and its CURRENT
   * boot, and answer WHICH lane it belongs to.
   *
   * Private, and that is the point: `acceptReport` is the only caller, so there
   * is exactly one derivation of the lane for every container this host runs.
   */
  private async resolveReportLane(identity: string): Promise<AgentLane | null> {
    const claims = await verifyScopedToken(
      this.deps.env.BETTER_AUTH_SECRET,
      "report",
      identity,
      Date.now(),
    );
    if (claims === null || claims.userId !== this.deps.userId) return null;
    return this.laneOfBoot(claims.ref);
  }

  /** Verify a container's bearer, then mint a provider access token. The egress
   * interceptor's only way to reach a credential. Either lane's container may
   * spend the user's quota; neither may reach the credential itself. */
  async mintProviderAccessToken(
    identity: string,
    providerId: string,
  ): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    const claims = await verifyScopedToken(
      this.deps.env.BETTER_AUTH_SECRET,
      "report",
      identity,
      Date.now(),
    );
    if (claims === null || claims.userId !== this.deps.userId) {
      return { ok: false, error: "the sandbox identity does not name this account" };
    }
    if (this.laneOfBoot(claims.ref) === null) {
      return { ok: false, error: "the sandbox identity belongs to a container that was replaced" };
    }
    const minted = await this.deps.providers.mintAccessTokenFor(providerId);
    return minted.ok ? { ok: true, token: minted.token } : { ok: false, error: minted.error };
  }

  // ---- container lifecycle --------------------------------------------------

  /**
   * Bring a lane's container to a state that can run THIS turn, and say what
   * the turn must seed it with.
   *
   * Three outcomes, and which one happens is decided by what has changed rather
   * than by how long ago the container started:
   *
   *   • COLD — the ordinary state, because the filesystem is deleted on sleep.
   *     Boot it and hand it the whole vault.
   *   • PINNED FACT MOVED — the provider, the model, the tool set, where
   *     reports go. None of them can be handed to a container that is already
   *     running (./sandbox-port), so this is a cold wake too. That is the whole
   *     of the bug this shape exists to make impossible: a fast path keyed on
   *     the boot id alone kept the container and silently ran the turn on the
   *     provider the user just switched away from.
   *   • SESSION STALE — the container is fine but its pi session is holding a
   *     conversation the user discarded, or was built with instructions the
   *     vault has since changed. `reset` replaces the session and leaves
   *     `./vault` alone, so a fresh thread costs a session rather than a
   *     re-materialized vault.
   */
  private async ensureContainer(
    lane: AgentLane,
    port: SandboxPort,
    provider: TurnProvider,
    conversation: string,
  ): Promise<{ ok: true; seed: readonly SandboxSeedTurn[] } | { ok: false; error: string }> {
    const reportUrl = this.reportUrl();
    if (reportUrl === null) {
      return {
        ok: false,
        error:
          "This deployment has no PUBLIC_HOST set, so the agent container has nowhere to " +
          "report to. Set it and deploy again.",
      };
    }
    const pins = this.bootPins(lane, provider, reportUrl);
    const digest = await pinsDigest(pins);
    const booted = this.storedBoot(lane);
    const state = await port.state();
    const warm =
      state.phase === "ready" &&
      booted !== null &&
      state.bootId === booted.id &&
      booted.pins === digest;

    if (!warm) {
      const bootId = crypto.randomUUID();
      const reportToken = await mintScopedToken(this.deps.env.BETTER_AUTH_SECRET, {
        scope: "report",
        userId: this.deps.userId,
        ref: bootId,
        expiresAt: Date.now() + REPORT_TOKEN_TTL_MS,
      });
      const outcome = await port.boot({
        bootId,
        reportToken,
        ...pins,
        instructions: await composeInstructions(this.deps.vault),
      });
      if (!outcome.ok) return outcome;
      // Stored only once the container accepted it, so a failed boot cannot
      // invalidate the token a live container is still using — and the digest
      // goes with the id, because half of a warm predicate is not one.
      this.deps.kv.put(BOOT_KEY[lane], { id: bootId, pins: digest } satisfies StoredBoot);
    }

    const heldRevision = warm && state.phase === "ready" ? state.vaultRevision : 0;
    const push = await this.buildVaultPush(heldRevision);
    if (!push.ok) return push;
    const materialized = await port.materialize(push.push);
    if (!materialized.ok) return materialized;

    // A container booted a moment ago has no session at all, so there is
    // nothing to reset and nothing it can already hold.
    if (!warm) return { ok: true, seed: this.seedFor(lane) };

    const held = state.phase === "ready" ? state.conversation : null;
    // Two reasons a live session cannot run this turn, and one verb for both:
    // it is holding a conversation this turn does not belong to, or the vault
    // moved a file the instructions are composed FROM, which pi baked into it.
    if ((held !== null && held !== conversation) || instructionsMoved(push.push)) {
      const reset = await port.reset({ instructions: await composeInstructions(this.deps.vault) });
      if (!reset.ok) return reset;
      return { ok: true, seed: this.seedFor(lane) };
    }
    // Seeding a session that already holds this conversation would replay every
    // turn as though the user had said it twice.
    return { ok: true, seed: held === conversation ? [] : this.seedFor(lane) };
  }

  /**
   * The pinned half of a boot, for `lane`.
   *
   * Built in ONE place and both booted with and hashed from it, so the facts
   * the predicate weighs and the facts the container receives cannot be two
   * different lists.
   */
  private bootPins(lane: AgentLane, provider: TurnProvider, reportUrl: string): SandboxBootPins {
    return {
      reportUrl,
      provider: {
        provider: provider.entry.id,
        modelId: provider.modelId,
        baseUrl: provider.entry.baseUrl,
        // A placeholder, never a credential: the outbound interceptor puts the
        // real token on the request (./egress).
        apiKey: "sandbox-managed",
      },
      tools: agentToolManifest(lane === "chat"),
      browser: browserRun(this.deps.env),
    };
  }

  /** The prior conversation a fresh session has to be told about. The
   * unattended lane carries none at all — it is a different container precisely
   * so it cannot. */
  private seedFor(lane: AgentLane): readonly SandboxSeedTurn[] {
    return lane === "background" ? [] : this.deps.chat.seed();
  }

  /** The container this object last booted for `lane`, or null when it has
   * booted none it can still recognize. */
  private storedBoot(lane: AgentLane): StoredBoot | null {
    const stored = this.deps.kv.get(BOOT_KEY[lane]);
    if (typeof stored !== "object" || stored === null) return null;
    const record: Record<string, unknown> = { ...stored };
    const id = record["id"];
    const pins = record["pins"];
    if (typeof id !== "string" || id === "" || typeof pins !== "string") return null;
    return { id, pins };
  }

  private async buildVaultPush(
    heldRevision: number,
  ): Promise<{ ok: true; push: SandboxVaultPush } | { ok: false; error: string }> {
    const toRevision = this.deps.revisions.current();
    const delta =
      heldRevision === toRevision
        ? { upserted: [], removed: [] }
        : this.deps.revisions.since(heldRevision);

    if (delta === null) {
      const live = this.deps.vault.list();
      if (live.length > MAX_MATERIALIZED_FILES) {
        return {
          ok: false,
          error:
            `This vault has ${live.length} files, more than the agent workspace can hold ` +
            `(${MAX_MATERIALIZED_FILES}).`,
        };
      }
      return {
        ok: true,
        push: {
          toRevision,
          replaceAll: true,
          upserted: await this.readFiles(live.map((entry) => entry.path)),
          removed: [],
        },
      };
    }
    return {
      ok: true,
      push: {
        toRevision,
        replaceAll: false,
        upserted: await this.readFiles(delta.upserted),
        removed: delta.removed,
      },
    };
  }

  /** Bytes for the named paths. A path the manifest no longer holds is simply
   * absent — the delta may name a file deleted since it was logged. */
  private async readFiles(paths: readonly string[]): Promise<SandboxVaultFile[]> {
    const files: SandboxVaultFile[] = [];
    for (let start = 0; start < paths.length; start += MATERIALIZE_BATCH) {
      const batch = paths.slice(start, start + MATERIALIZE_BATCH);
      const read = await Promise.all(
        batch.map(async (path): Promise<SandboxVaultFile | null> => {
          try {
            return { path, bytes: await this.deps.vault.readBytes(path) };
          } catch {
            return null;
          }
        }),
      );
      for (const file of read) if (file !== null) files.push(file);
    }
    return files;
  }

  // ---- report application ---------------------------------------------------

  private applyChatEvent(event: AppAgentEvent): void {
    // The transcript records what a later session must be able to replay; the
    // broadcast is what the open window renders. They are the same events and
    // different subsets, so both happen here rather than in two places that
    // could disagree about which events matter.
    switch (event.type) {
      case "message_end":
        if (event.role === "assistant") {
          const errored = event.stopReason === "error";
          const text = errored ? (event.errorMessage ?? event.text) : event.text;
          if (text !== "") this.deps.chat.appendAssistant(text, errored);
        }
        break;
      case "tool_execution_start":
        // Opened here and settled below, so the row carries the tool's NAME —
        // which only the start event has — without the object holding
        // cross-request memory of a turn it may be evicted in the middle of.
        this.deps.chat.openTool(event.toolName, event.toolCallId);
        break;
      case "tool_execution_end":
        this.deps.chat.settleTool(event.toolCallId, event.resultText, event.isError);
        break;
      case "turn_error":
        this.deps.chat.appendAssistant(event.reason, true);
        break;
      case "agent_start":
        this.setBusy(true);
        break;
      case "agent_end":
        this.setBusy(false);
        break;
      default:
        break;
    }
    this.deps.emitAgentEvent(event);
  }

  /**
   * Fold one unattended event into the run's own record.
   *
   * The transcript is what the inline badge shows while the task works, so it
   * takes streamed deltas and a line per tool call. `result` is what the owning
   * surface records afterwards, and is the last COMPLETE assistant message —
   * which is also why the message is appended to the transcript only when no
   * deltas already carried it.
   */
  private applyBackgroundEvent(run: BackgroundRun, event: AppAgentEvent): void {
    switch (event.type) {
      case "message_update":
        this.streamBackground(run, event.delta);
        break;
      case "tool_execution_start": {
        const current = this.deps.runs.runAt(run.turnId)?.transcript ?? "";
        this.streamBackground(run, `${current === "" ? "" : "\n\n"}\`⚙ ${event.toolName}\``);
        break;
      }
      case "message_end": {
        if (event.role !== "assistant" || event.text === "") break;
        this.deps.runs.setResult(run.turnId, event.text);
        const current = this.deps.runs.runAt(run.turnId)?.transcript ?? "";
        if (!current.endsWith(event.text)) this.streamBackground(run, event.text);
        break;
      }
      case "turn_error":
        this.deps.runs.setFailure(run.turnId, event.reason);
        break;
      default:
        break;
    }
  }

  private streamBackground(run: BackgroundRun, text: string): void {
    const transcript = this.deps.runs.appendTranscript(run.turnId, text);
    if (transcript !== null) this.deps.onBackgroundStream(run, transcript);
  }

  /**
   * Apply the agent's own file writes to the vault of record.
   *
   * REMOVALS ARE REFUSED HERE, on purpose. The grant table puts deletion in the
   * destructive tier, where a human answers before anything is trashed; a
   * container-side `rm` that the host applied would be the same effect with
   * nobody asked. The agent deletes through `delete_note`, and the refusal says
   * so — which is also what makes `bash rm` inside the container a no-op
   * against the vault rather than a silent success.
   *
   * Writes capture a restore point first, fail-closed: no undo point, no write.
   * `scope` is what decides which undo surface owns it — the conversation's
   * toast, or the background task's "Restore original".
   *
   * The write itself is UNCONDITIONAL — last write wins, exactly as the editor's
   * autosave is. The alternative would be to write at the version the container
   * materialized, which sounds safer and is not: a note the user edited while
   * the agent was working would REJECT the agent's turn outright, stranding work
   * with nothing to recover it. Last-write-wins plus the restore point above
   * loses nothing — the user can put the note back — and the manifest, the
   * index and the deletion gate all still see an ordinary vault write.
   *
   * EVERY REFUSAL IS NAMED IN THE ANSWER, and the container is required to read
   * it: the agent's own file tools already told the model the write succeeded —
   * against a copy — so a refusal nobody relays is a model that goes on
   * building on a note the user does not have.
   */
  private async applyVaultOps(
    report: { readonly fromRevision: number; readonly ops: readonly VaultOp[] },
    scope: SnapshotScope,
  ): Promise<AgentReportReply> {
    // Read BEFORE anything is applied: the container may adopt a revision only
    // if its own baseline was still the vault's when this batch started.
    const started = this.deps.revisions.current();
    const rejected: string[] = [];
    let applied = 0;
    for (const op of report.ops) {
      if (op.op === "remove") {
        rejected.push(`${op.path}: use delete_note, which asks the user first`);
        continue;
      }
      const bytes = base64ToBytes(op.bytesBase64);
      if (bytes === null) {
        rejected.push(`${op.path}: the reported bytes were not valid base64`);
        continue;
      }
      if ((await this.deps.snapshots.capture(scope, op.path)) === null) {
        rejected.push(`${op.path}: no restore point could be saved, so it was not written`);
        continue;
      }
      const written = await this.deps.vault.write(op.path, bytes);
      if (written.ok) applied += 1;
      else rejected.push(`${op.path}: ${written.reason}`);
    }
    return {
      kind: "vault",
      revision: this.adoptableRevision(report.fromRevision, started, applied),
      rejected,
    };
  }

  /**
   * The revision the reporting container may claim to hold, once its own ops
   * have been applied.
   *
   * `current()` ONLY when the container's baseline was the vault's revision
   * when this batch began and the batch moved it by exactly its own successful
   * writes — one log entry per written path. Any other reading means something
   * else moved the vault (a browser edit landing mid-turn, another lane, an
   * upload), and that file has to stay in this container's next delta: a
   * container that adopted a revision past it would never be sent the file
   * again, and the agent would read a copy the user has since changed.
   *
   * Falling back to the baseline is always safe — it costs a re-push of files
   * the container already has, which is the same work a cold wake does.
   */
  private adoptableRevision(from: number, started: number, applied: number): number {
    if (started !== from) return from;
    const ended = this.deps.revisions.current();
    return ended - started === applied ? ended : from;
  }

  // ---- internals ------------------------------------------------------------

  private toolContext(
    scope: SnapshotScope,
    turnId: string,
    attended: boolean,
  ): Parameters<typeof executeAgentTool>[0] {
    return {
      vault: this.deps.vault,
      knowledge: this.deps.knowledge,
      snapshots: this.deps.snapshots,
      delegations: this.deps.delegations(),
      scope,
      turnId,
      attended,
      confirm: (proposal) => this.confirmations.ask(proposal),
    };
  }

  /** Whether `turnId` names the chat turn this object last dispatched. A host
   * that has never dispatched one has nothing to disagree with — a container
   * that was already running when this object first woke still has a turn to
   * finish. */
  private isCurrentChatTurn(turnId: string): boolean {
    const tracked = this.chatTurnId();
    return tracked === "" || tracked === turnId;
  }

  /** Which lane's CURRENT container `boot` names, or null when it names one
   * that has been replaced. The empty string is never a live boot — it is what
   * a lane that has never booted reads back as. */
  private laneOfBoot(boot: string): AgentLane | null {
    if (boot === "") return null;
    for (const lane of ["chat", "background"] satisfies AgentLane[]) {
      if (boot === this.storedBoot(lane)?.id) return lane;
    }
    return null;
  }

  /**
   * Where a container posts its reports, or `null` when this deployment has
   * nowhere to name.
   *
   * Configured rather than derived: the container reaches this Worker over the
   * public internet, so the value has to be the deployment's own public origin,
   * which nothing inside a Durable Object invocation can know. The last
   * authenticated socket's origin is the fallback, which covers local dev.
   *
   * `null` refuses the boot rather than shipping a RELATIVE url the container
   * would fail to dial with an error that says nothing about the cause. The
   * scripted runtime is exempt: it reports in-process, so an origin it will
   * never use must not stop it from starting.
   */
  private reportUrl(): string | null {
    const path = `/v1/agent/${encodeURIComponent(this.deps.userId)}/report`;
    const host = this.deps.env.PUBLIC_HOST;
    if (host !== undefined && host !== "") return `https://${host}${path}`;
    const origin = this.deps.publicOrigin();
    if (origin !== "") return `${origin}${path}`;
    return sandboxRuntimeEnabled(this.deps.env) ? null : path;
  }

  private setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.deps.onBusyChanged();
  }
}

/**
 * A digest over every PINNED boot fact, which is what the warm predicate
 * compares.
 *
 * Over the whole group rather than a hand-picked field or two: the group is a
 * type, so building one is total, and hashing what was built means a fact added
 * to `SandboxBootPins` joins the predicate by existing rather than by someone
 * remembering to name it here. A digest rather than the JSON itself because the
 * tool manifest is kilobytes of schema and this is written to the object's own
 * storage on every boot.
 */
function pinsDigest(pins: SandboxBootPins): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(pins)));
}

/**
 * Whether a vault push moved a file the agent's instructions are composed FROM.
 *
 * Read off the push the wake computes anyway, so a warm turn pays nothing for
 * it. `replaceAll` means the change log could not answer what moved, and an
 * unanswerable question about a prompt the model is running on is taken as a
 * yes.
 */
function instructionsMoved(push: SandboxVaultPush): boolean {
  if (push.replaceAll) return true;
  return (
    push.upserted.some((file) => instructionsDependOn(file.path)) ||
    push.removed.some((path) => instructionsDependOn(path))
  );
}

/** How a background run ended, read off the run's own record. A stop the user
 * asked for wins over every other reading — the interrupt is why the turn
 * ended at all. */
function backgroundOutcome(run: BackgroundRun, reportError: string | null): BackgroundOutcome {
  if (run.stopRequested) return { kind: "stopped" };
  if (reportError !== null) return { kind: "failed", error: reportError };
  if (run.failure !== "") return { kind: "failed", error: run.failure };
  return { kind: "done", text: run.result };
}
