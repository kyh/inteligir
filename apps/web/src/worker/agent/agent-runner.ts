// ---------------------------------------------------------------------------
// The agent's turn lifecycle, inside the user's own Durable Object.
//
// THE RULE THIS MODULE ENFORCES: a Durable Object never awaits a turn. A
// delegation or a routine runs for up to ten minutes, and an object that waited
// on one would hold an invocation open for the whole of it — with the user's
// sockets, their vault manifest and their knowledge index behind it. So `send`
// resolves as soon as the container has ACCEPTED the turn, and everything the
// turn produces arrives later, as separate short requests into the report path
// (`report`).
//
// That inverts the desktop's shape, where the agent was an in-process object
// whose events arrived on a callback. Here the sequence is:
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
// TWO LANES, TWO CONTAINERS. The desktop ran unattended work — delegation,
// routines — on a SECOND pi session, so a background task could never see the
// conversation and the conversation could never see it. Here the isolation unit
// is the container, and the reason it has to be the container rather than a
// second session inside one is the vault: the container reports the agent's
// file writes from a filesystem WATCHER, which cannot say which session wrote a
// file. Two sessions sharing one `./vault` would make every agent write
// ambiguous between an attended edit the chat toast can undo and an unattended
// one the delegation dock owns. Two containers make the lane a fact of the
// CREDENTIAL instead: each boots with its own report bearer, and the route
// resolves the lane from the token rather than from anything the caller says.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import { parseAgentEvent } from "@repo/bridge/agent-event-parser";
import type { AgentConfirmationRequest } from "@repo/bridge/ipc-registry";
import type { TextChatMessage } from "@repo/bridge/chat-message";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import {
  base64ToBytes,
  type AgentReport,
  type AgentReportReply,
  type VaultOp,
} from "@repo/agent-container/protocol";

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
import { composeInstructions } from "./agent-instructions";
import type { AgentSnapshots, SnapshotScope } from "./agent-snapshots";
import { agentToolManifest, executeAgentTool, type DelegationToolPort } from "./agent-tools";
import type { ChatStore } from "./chat-store";
import { ConfirmationBroker } from "./confirmations";
import {
  providerEntry,
  resolveModelId,
  sandboxRuntimeEnabled,
  type ProviderEntry,
} from "./provider-catalog";
import type { ProviderCredentials } from "./provider-credentials";
import type {
  SandboxPort,
  SandboxSeedTurn,
  SandboxVaultFile,
  SandboxVaultPush,
} from "./sandbox-port";
import type { VaultRevisions } from "./vault-revisions";

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
const BOOT_ID_KEY: Record<AgentLane, string> = {
  chat: "agent/boot-id",
  background: "agent/boot-id/background",
};

/**
 * Cloudflare Browser Run's CDP endpoint, or `null` when this deployment has no
 * Browser Run account.
 *
 * `keep_alive` is what stops the remote browser closing between two tool calls
 * in one turn; ten minutes matches the container's own idle window, so the
 * browser and the container go away together.
 */
function browserRun(env: Env): { cdpUrl: string; token: string } | null {
  const accountId = env.BROWSER_RUN_ACCOUNT_ID;
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

/** Synchronous key-value storage — the Durable Object's `ctx.storage.kv`.
 * `get` answers `unknown` for ./provider-credentials' reason: what comes back
 * is JSON an earlier version of this code wrote. */
type RunnerKv = {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
};

export type AgentRunnerDeps = {
  readonly env: Env;
  readonly userId: string;
  readonly kv: RunnerKv;
  readonly vault: UserVault;
  readonly knowledge: UserKnowledge;
  readonly chat: ChatStore;
  readonly snapshots: AgentSnapshots;
  readonly credentials: ProviderCredentials;
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

  /**
   * Why no turn can run right now, or null.
   *
   * One sentence for every surface — the composer, a delegation create, a
   * routine tick — because the fix is the same one in all three and a second
   * phrasing would only be a second thing to keep true.
   */
  providerRefusal(): string | null {
    const selection = this.deps.credentials.selection();
    const provider = selection === null ? null : providerEntry(selection.provider);
    if (provider === null) return "No AI provider is selected. Choose one in Settings → AI.";
    if (!this.deps.credentials.connected(provider.id)) {
      return `${provider.label} is not connected. Connect it in Settings → AI.`;
    }
    return null;
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

    const refusal = this.providerRefusal();
    if (refusal !== null) throw new Error(refusal);
    const provider = this.selectedProvider();
    if (provider === null) throw new Error("No AI provider is selected.");

    // The message is recorded LAST, once a container has accepted it. Anything
    // that fails before then — a cold container that will not start, a vault
    // too large to hand over, a dispatch the container refused — leaves the
    // transcript untouched, so a retry sends the message once rather than
    // twice. The composer's optimistic bubble is what tells the user it did
    // not go.
    const port = this.deps.sandbox("chat");
    const seed = await this.ensureContainer("chat", port, provider);
    if (!seed.ok) throw new Error(seed.error);

    const outcome = await port.dispatch({
      turnId: crypto.randomUUID(),
      kind: command.type,
      text: command.text,
      images: command.images ?? [],
      seed: seed.seed,
      // What the container's session will hold once this turn runs. Only ever
      // compared against zero — it marks a session as seeded rather than
      // addressing a point in the transcript.
      seededThrough: this.deps.chat.head() + 1,
    });
    if (!outcome.ok) throw new Error(outcome.error);
    this.deps.chat.appendUser(command.text);
    this.setBusy(true);
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
    const refusal = this.providerRefusal();
    if (refusal !== null) return { ok: false, reason: "refused", error: refusal };
    const provider = this.selectedProvider();
    if (provider === null) {
      return { ok: false, reason: "refused", error: "No AI provider is selected." };
    }
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
      const ready = await this.ensureContainer("background", port, provider);
      if (!ready.ok) return refuse(ready.error);
      const dispatched = await port.dispatch({
        turnId: run.turnId,
        kind: "user_message",
        text: prepared.prompt,
        images: [],
        // An unattended turn carries no conversation, which is the whole point
        // of the second container.
        seed: [],
        seededThrough: 0,
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

  /** Roll a fresh thread. The container keeps running; the next turn seeds it
   * from the new (empty) transcript, which is what makes the fresh thread
   * fresh to the model too. */
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
   * One report from a container.
   *
   * The caller has already proven the bearer AND read the lane off it; this is
   * where a report BECOMES something — a transcript entry, a broadcast, a vault
   * write, a tool result. The scripted sandbox calls it directly, so this is the
   * same path in both runtimes.
   */
  report(report: AgentReport, lane: AgentLane): Promise<AgentReportReply> {
    return lane === "background" ? this.reportBackground(report) : this.reportChat(report);
  }

  private async reportChat(report: AgentReport): Promise<AgentReportReply> {
    const scope: SnapshotScope = { origin: "chat", ref: this.deps.chat.activeSessionId() };
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
        return this.applyVaultOps(report.ops, scope);
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
          kind: "vault",
          revision: this.deps.revisions.current(),
          rejected: report.ops.map(
            (op) => `${op.path}: no background task is running, so nothing was written`,
          ),
        };
      }
      return this.applyVaultOps(report.ops, { origin: holder.owner, ref: holder.ref });
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
   * The lane is a property of the credential, never of the report body: a
   * container that claimed to be the other one would be claiming a different
   * undo surface for its writes.
   */
  async resolveReportLane(identity: string): Promise<AgentLane | null> {
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
    const entry = providerEntry(providerId);
    if (entry === null) return { ok: false, error: "unknown provider" };
    const minted = await this.deps.credentials.mintAccessToken(entry);
    return minted.ok ? { ok: true, token: minted.token } : { ok: false, error: minted.error };
  }

  // ---- container lifecycle --------------------------------------------------

  /**
   * Bring a lane's container to a state that can run a turn, and say what the
   * turn must seed it with.
   *
   * A container that is cold — which is the ordinary state — is booted and
   * handed the whole vault. One that is warm gets the delta since the revision
   * it reports holding, and seeds nothing, because its pi session already has
   * the conversation.
   */
  private async ensureContainer(
    lane: AgentLane,
    port: SandboxPort,
    provider: ProviderEntry,
  ): Promise<{ ok: true; seed: readonly SandboxSeedTurn[] } | { ok: false; error: string }> {
    const state = await port.state();
    const warm = state.phase === "ready" && state.bootId === this.bootId(lane);

    if (!warm) {
      const reportUrl = this.reportUrl();
      if (reportUrl === null) {
        return {
          ok: false,
          error:
            "This deployment has no PUBLIC_HOST set, so the agent container has nowhere to " +
            "report to. Set it and deploy again.",
        };
      }
      const bootId = crypto.randomUUID();
      const reportToken = await mintScopedToken(this.deps.env.BETTER_AUTH_SECRET, {
        scope: "report",
        userId: this.deps.userId,
        ref: bootId,
        expiresAt: Date.now() + REPORT_TOKEN_TTL_MS,
      });
      const booted = await port.boot({
        bootId,
        reportUrl,
        reportToken,
        provider: {
          provider: provider.id,
          modelId: resolveModelId(provider, this.deps.credentials.selection()?.modelId),
          baseUrl: provider.baseUrl,
          // A placeholder, never a credential: the outbound interceptor puts
          // the real token on the request (./egress).
          apiKey: "sandbox-managed",
        },
        tools: agentToolManifest(lane === "chat"),
        instructions: await composeInstructions(this.deps.vault),
        browser: browserRun(this.deps.env),
      });
      if (!booted.ok) return booted;
      // The boot id is stored only once the container accepted it, so a failed
      // boot cannot invalidate the token a live container is still using.
      this.deps.kv.put(BOOT_ID_KEY[lane], bootId);
    }

    const heldRevision = warm && state.phase === "ready" ? state.vaultRevision : 0;
    const push = await this.buildVaultPush(heldRevision);
    if (!push.ok) return push;
    const materialized = await port.materialize(push.push);
    if (!materialized.ok) return materialized;

    // The background lane carries no conversation at all — it is a different
    // container precisely so it cannot.
    if (lane === "background") return { ok: true, seed: [] };
    const seededThrough = warm && state.phase === "ready" ? state.seededThrough : 0;
    // A warm container's pi session already holds the conversation; seeding it
    // again would replay every turn as though the user had said it twice.
    return { ok: true, seed: seededThrough > 0 ? [] : this.deps.chat.seed() };
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
   */
  private async applyVaultOps(
    ops: readonly VaultOp[],
    scope: SnapshotScope,
  ): Promise<AgentReportReply> {
    const rejected: string[] = [];
    for (const op of ops) {
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
      if (!written.ok) rejected.push(`${op.path}: ${written.reason}`);
    }
    return { kind: "vault", revision: this.deps.revisions.current(), rejected };
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

  private selectedProvider(): ProviderEntry | null {
    const selection = this.deps.credentials.selection();
    return selection === null ? null : providerEntry(selection.provider);
  }

  private bootId(lane: AgentLane): string {
    const stored = this.deps.kv.get(BOOT_ID_KEY[lane]);
    return typeof stored === "string" ? stored : "";
  }

  /** Which lane's CURRENT container `boot` names, or null when it names one
   * that has been replaced. The empty string is never a live boot — it is what
   * a lane that has never booted reads back as. */
  private laneOfBoot(boot: string): AgentLane | null {
    if (boot === "") return null;
    for (const lane of ["chat", "background"] satisfies AgentLane[]) {
      if (boot === this.bootId(lane)) return lane;
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

/** How a background run ended, read off the run's own record. A stop the user
 * asked for wins over every other reading, exactly as it does on the desktop —
 * the interrupt is why the turn ended at all. */
function backgroundOutcome(run: BackgroundRun, reportError: string | null): BackgroundOutcome {
  if (run.stopRequested) return { kind: "stopped" };
  if (reportError !== null) return { kind: "failed", error: reportError };
  if (run.failure !== "") return { kind: "failed", error: run.failure };
  return { kind: "done", text: run.result };
}
