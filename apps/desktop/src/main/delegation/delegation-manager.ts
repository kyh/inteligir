// ---------------------------------------------------------------------------
// DelegationManager — the store + serialized queue behind checkbox delegation.
//
// A delegation is created when the user clicks "Delegate" on a checkbox. It is
// persisted, queued, and run one-at-a-time on the background agent
// (background-agent.ts), which edits the vault file directly: it does the task,
// checks the box off, and appends a short result. The vault watcher then
// refreshes the editor. We track status purely so the UI can show an inline
// badge on the delegated line.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { findTaskLine } from "@/main/delegation/find-task-line";
import { JsonStore, inteligirPath, type FsAdapter } from "@/main/lib/json-store";
import { getVaultManager } from "@/main/vault";
import { parseAgentEvent } from "@/shared/agent-event-parser";
import {
  DelegationSchema,
  type CreateDelegationParams,
  type CreateDelegationResult,
  type Delegation,
} from "@/shared/delegation";
import { toErrorMessage } from "@/shared/ipc";

// v2: anchor moved from text/heading matching to a positional `index`.
const DELEGATIONS_VERSION = 2;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_DELEGATIONS = 200;
const SUMMARY_LEN = 200;
// Re-poll interval when the agent is busy but work is queued (e.g. a prior
// interrupt hasn't settled), so a queued delegation is never stranded.
const BUSY_RETRY_MS = 1000;

const DelegationsFileSchema = Type.Object(
  { version: Type.Literal(DELEGATIONS_VERSION), delegations: Type.Array(DelegationSchema) },
  { additionalProperties: false },
);

// The subset of the Agent surface a delegation run drives. Structural so the
// real Agent satisfies it and tests can pass a lightweight fake without casts.
export type DelegationAgent = {
  subscribe(listener: (event: unknown) => void): () => void;
  getState(): { status: string };
  sendMessage(message: string): Promise<void>;
  waitForIdle(timeoutMs: number): Promise<boolean>;
  interrupt(): Promise<unknown>;
};

// Change notification — push channel for the editor's inline badges. Wired from
// Electron-side composition (app-machine) so this module stays electron-free.
let changedNotifier: ((delegations: Delegation[]) => void) | null = null;

export function setDelegationsChangedNotifier(
  notifier: ((delegations: Delegation[]) => void) | null,
): void {
  changedNotifier = notifier;
}

export type DelegationManagerOptions = {
  fs?: FsAdapter;
  path?: string;
  /** Read a vault file's raw text. Defaults to the live VaultManager. */
  readVault?: (rel: string) => string;
};

export class DelegationManager {
  private readonly store: JsonStore<Delegation[]>;
  private readonly readVault: (rel: string) => string;
  private getAgent: (() => DelegationAgent | null) | null = null;
  private running = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Set when the background agent can't run delegations at all (e.g. it failed
  // to start). New delegations are rejected with this reason instead of sitting
  // "queued" forever; cleared once a working runner is wired.
  private unavailableReason: string | null = null;

  constructor(opts?: DelegationManagerOptions) {
    this.readVault = opts?.readVault ?? ((rel) => getVaultManager().readText(rel));
    this.store = new JsonStore<Delegation[]>(
      opts?.path ?? inteligirPath("delegations.json"),
      DelegationsFileSchema,
      [],
      {
        fs: opts?.fs,
        versioning: {
          current: DELEGATIONS_VERSION,
          fromLegacy: () => ({ version: DELEGATIONS_VERSION, delegations: [] }),
        },
        decode: (raw) => {
          if (!Value.Check(DelegationsFileSchema, raw))
            throw new Error("delegations shape rejected");
          return raw.delegations;
        },
        encode: (delegations) => ({ version: DELEGATIONS_VERSION, delegations }),
      },
    );
  }

  getDelegations(): Delegation[] {
    return this.store.read();
  }

  /** Wire the background agent accessor + kick the queue (a delegation may have
   * been queued before the agent was ready). */
  setRunner(getAgent: () => DelegationAgent | null): void {
    this.getAgent = getAgent;
    this.unavailableReason = null;
    void this.processNext();
  }

  stop(): void {
    this.getAgent = null;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processNext();
    }, BUSY_RETRY_MS);
  }

  /** Mark delegation unavailable (the background agent failed to start). Fail
   * every still-queued delegation so they don't sit "Queued" forever, and
   * reject new ones until a runner is wired. */
  markUnavailable(reason: string): void {
    this.unavailableReason = reason;
    this.getAgent = null;
    let changed = false;
    this.store.update((all) =>
      all.map((d) => {
        if (d.status !== "queued") return d;
        changed = true;
        return { ...d, status: "failed", finishedAt: Date.now(), error: reason };
      }),
    );
    if (changed) this.notify();
  }

  /** Create + enqueue a delegation. Resolves the checkbox line from the vault
   * file first so a stale/edited checkbox is rejected before it queues. */
  createDelegation(params: CreateDelegationParams): CreateDelegationResult {
    if (this.unavailableReason !== null) return { ok: false, error: this.unavailableReason };
    let raw: string;
    try {
      raw = this.readVault(params.sourceFile);
    } catch (err) {
      return { ok: false, error: `Couldn't read ${params.sourceFile}: ${toErrorMessage(err)}` };
    }
    const match = findTaskLine(raw, params.index);
    if (!match) {
      return {
        ok: false,
        error: "That checkbox is no longer in the file — save your edits first.",
      };
    }

    const delegation: Delegation = {
      id: crypto.randomUUID(),
      sourceFile: params.sourceFile,
      anchor: { index: params.index, text: match.text, heading: match.heading },
      lineText: match.lineText.trim(),
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      resultSummary: null,
      error: null,
    };
    this.store.update((all) => {
      const next = [...all, delegation];
      return next.length > MAX_DELEGATIONS ? next.slice(-MAX_DELEGATIONS) : next;
    });
    this.notify();
    void this.processNext();
    return { ok: true, delegation };
  }

  /** Cancel a still-queued delegation. A running one can't be pulled back. */
  cancelDelegation(id: string): { ok: boolean } {
    let changed = false;
    this.store.update((all) =>
      all.filter((d) => {
        if (d.id === id && d.status === "queued") {
          changed = true;
          return false;
        }
        return true;
      }),
    );
    if (changed) this.notify();
    return { ok: changed };
  }

  private patch(id: string, patch: Partial<Delegation>): void {
    this.store.update((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    this.notify();
  }

  private notify(): void {
    try {
      changedNotifier?.(this.getDelegations());
    } catch (err) {
      console.warn("[delegation] change notification failed:", err);
    }
  }

  /** Run the oldest queued delegation if the agent is free. Re-entrant-safe via
   * `running`; re-invokes itself after each run so the queue drains. */
  private async processNext(): Promise<void> {
    if (this.running) return;
    const agent = this.getAgent?.();
    if (!agent) return;
    if (agent.getState().status === "busy") {
      // Busy but nothing re-triggers us once it frees (e.g. a timed-out run left
      // it busy after interrupt) — poll so queued work isn't stranded.
      if (this.getDelegations().some((d) => d.status === "queued")) this.scheduleRetry();
      return;
    }
    const next = this.getDelegations().find((d) => d.status === "queued");
    if (!next) return;

    this.running = true;
    try {
      await this.run(agent, next);
    } catch (err) {
      console.error("[delegation] run failed:", err);
    } finally {
      this.running = false;
      void this.processNext();
    }
  }

  private async run(agent: DelegationAgent, delegation: Delegation): Promise<void> {
    this.patch(delegation.id, { status: "running", startedAt: Date.now() });

    const captured: { text: string | null } = { text: null };
    const unsubscribe = agent.subscribe((raw) => {
      const event = parseAgentEvent(raw);
      if (event?.type === "message_end" && event.role === "assistant" && event.text) {
        captured.text = event.text;
      }
    });

    try {
      await agent.sendMessage(buildPrompt(delegation));
      const finished = await agent.waitForIdle(RUN_TIMEOUT_MS);
      if (!finished) {
        await agent.interrupt().catch(() => {});
        this.patch(delegation.id, {
          status: "failed",
          finishedAt: Date.now(),
          error: "Timed out",
        });
        return;
      }
      this.patch(delegation.id, {
        status: "done",
        finishedAt: Date.now(),
        resultSummary: captured.text?.trim().slice(0, SUMMARY_LEN) ?? "Done",
      });
    } catch (err) {
      this.patch(delegation.id, {
        status: "failed",
        finishedAt: Date.now(),
        error: toErrorMessage(err),
      });
    } finally {
      unsubscribe();
    }
  }
}

/** The instruction the background agent runs. It edits the file directly. */
function buildPrompt(d: Delegation): string {
  const where = d.anchor.heading ? ` under the "${d.anchor.heading}" section` : "";
  return [
    `You've been delegated a single to-do item from a markdown note. Do it, then record the outcome in the file.`,
    ``,
    `File: ./vault/${d.sourceFile}`,
    `Task${where}: ${d.anchor.text}`,
    ``,
    `Steps:`,
    `1. Do the task. Use your file tools and any connected tools (calendar, email, web, etc.) as needed.`,
    `2. In ./vault/${d.sourceFile}, find the line "${d.lineText}" and change its checkbox from "[ ]" to "[x]".`,
    `3. Immediately under that line, add an indented sub-item with a one-line result, e.g. "    - ✅ <what you did>". If you couldn't complete it, note why instead and leave the checkbox unchecked.`,
    `Keep edits minimal — change only those lines. Don't reformat the rest of the file. Reply with a one-sentence summary of what you did.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the vault/task managers.
// ---------------------------------------------------------------------------

let instance: DelegationManager | null = null;

export function getDelegationManager(): DelegationManager {
  if (!instance) instance = new DelegationManager();
  return instance;
}

export function resetDelegationManager(): void {
  instance?.stop();
  instance = null;
}
