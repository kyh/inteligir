// ---------------------------------------------------------------------------
// Agent confirmation broker — the destructive-confirmed tier of the grant
// table (@repo/bridge/agent-grants). The agent PROPOSES; a human answers in
// the conversation.
//
// Shape borrowed wholesale from the HTML-app broker's `confirmRemove` hook: a
// destructive capability awaits a confirm function before it touches anything,
// and a "no" is an ordinary VALUE the caller relays, never an exception. The
// difference is only where the human sits — the broker's hook resolves in the
// renderer that called it, this one has to cross the transport, so a request
// with nobody to answer it must not hang the agent's turn forever.
//
// Fail-closed on every non-answer: an expired request, a torn-down host, an
// interrupted turn and an unknown reply id all resolve to DECLINED. The only
// path to `true` is a live reply carrying the id we minted.
//
// POLICY, NOT ENFORCEMENT (CLAUDE.md § Decisions): this asks a human, it does
// not stop a model. There is no agent sandbox, so `bash rm` reaches the same
// file with nothing to click, and the peekaboo bundle can click the dialog
// this raises. It governs what the agent does deliberately.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

import { emitEvent } from "../events";
import type { AgentConfirmationRequest } from "@repo/bridge/ipc-registry";

/** How long a proposal waits for a human before it declines itself. Long
 * enough to read a dialog and think; short enough that a turn whose window is
 * gone settles rather than pinning the agent's tool call open. */
const CONFIRMATION_TIMEOUT_MS = 3 * 60_000;

/** What the caller describes; the host stamps the id. */
export type ConfirmationProposal = Omit<AgentConfirmationRequest, "id">;

export class ConfirmationBroker {
  private readonly pending = new Map<string, (confirmed: boolean) => void>();

  constructor(
    private readonly emit: (request: AgentConfirmationRequest) => void,
    private readonly timeoutMs: number = CONFIRMATION_TIMEOUT_MS,
  ) {}

  /** Ask the human. Resolves false on decline, timeout, abort, or teardown. */
  ask(proposal: ConfirmationProposal, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted === true) return Promise.resolve(false);
    const id = crypto.randomUUID();
    // The resolver is lifted out of the executor so there is exactly one
    // `resolve` call site (in `settle`) no matter how many ways a proposal can
    // end: reply, timeout, abort, teardown.
    let answer: ((confirmed: boolean) => void) | null = null;
    const answered = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const settle = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      this.pending.delete(id);
      if (timer !== null) clearTimeout(timer);
      answer?.(confirmed);
    };
    timer = setTimeout(() => {
      settle(false);
    }, this.timeoutMs);
    // A pending confirmation must never hold the process open: the turn it
    // belongs to is already keeping the host alive, and an unanswered proposal
    // is a decline.
    timer.unref?.();
    this.pending.set(id, settle);
    signal?.addEventListener(
      "abort",
      () => {
        settle(false);
      },
      { once: true },
    );
    // Emitting LAST, with the pending entry already in place, so a reply
    // cannot arrive before there is anything to resolve.
    try {
      this.emit({ ...proposal, id });
    } catch {
      settle(false);
    }
    return answered;
  }

  /** Deliver a human's answer. Unknown ids are ignored — the broker owns
   * expiry, so a late reply must not resurrect a settled proposal. */
  resolve(id: string, confirmed: boolean): void {
    this.pending.get(id)?.(confirmed);
  }

  /** Decline everything still waiting (teardown). */
  close(): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const settle of waiting) settle(false);
  }
}

let instance: ConfirmationBroker | null = null;

export function getConfirmationBroker(): ConfirmationBroker {
  if (!instance) {
    instance = new ConfirmationBroker((request) => {
      emitEvent("onAgentConfirmationRequested", request);
    });
  }
  return instance;
}

export function resetConfirmationBroker(): void {
  instance?.close();
  instance = null;
}
