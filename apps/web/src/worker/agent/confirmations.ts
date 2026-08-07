// ---------------------------------------------------------------------------
// The destructive tier's human — the agent PROPOSES, a person answers in the
// conversation.
//
// Fail-closed on every non-answer: an expired proposal, a torn-down object, an
// unknown reply id and a client that closed its socket all resolve to DECLINED.
// The only path to `true` is a live reply carrying the id this object minted.
//
// Held in memory ON PURPOSE, which is worth being precise about in an object
// whose every other in-memory field is a bug. The object is
// resident for the whole time a proposal is pending — the container's tool call
// is an in-flight request into it, and an in-flight request is what keeps a
// Durable Object from being evicted. So a pending map cannot outlive the
// invocation that owns it, and eviction cannot silently drop a proposal the
// user is still looking at: the tool call would have to fail first, and the
// agent sees that as a refusal.
//
// The timeout is short for a reason that is also the cost: a pending proposal
// pins a Durable Object, and an unanswered dialog should not bill for minutes
// of one.
//
// POLICY, NOT ENFORCEMENT (CLAUDE.md § Decisions): this asks a human, it does
// not stop a model. The agent has a shell inside the container and can reach
// the file it is asking about — though not the vault of record, which only
// reaches this object through the report route. It governs what the agent does
// deliberately.
// ---------------------------------------------------------------------------

import type { AgentConfirmationRequest } from "@repo/bridge/ipc-registry";

/** How long a proposal waits before it declines itself. */
const CONFIRMATION_TIMEOUT_MS = 90_000;

export type ConfirmationProposal = Omit<AgentConfirmationRequest, "id">;

export class ConfirmationBroker {
  private readonly pending = new Map<string, (confirmed: boolean) => void>();

  constructor(
    private readonly emit: (request: AgentConfirmationRequest) => void,
    private readonly timeoutMs: number = CONFIRMATION_TIMEOUT_MS,
  ) {}

  /** Ask the human. Resolves false on decline, timeout, or teardown. */
  ask(proposal: ConfirmationProposal): Promise<boolean> {
    const id = crypto.randomUUID();
    // The resolver is lifted out of the executor so there is exactly one
    // `resolve` call site no matter how many ways a proposal can end.
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
    this.pending.set(id, settle);
    // Emitted LAST, with the pending entry already in place, so a reply cannot
    // arrive before there is anything to resolve.
    try {
      this.emit({ ...proposal, id });
    } catch {
      settle(false);
    }
    return answered;
  }

  /** Deliver a human's answer. Unknown ids are ignored — this broker owns
   * expiry, so a late reply must not resurrect a settled proposal. */
  resolve(id: string, confirmed: boolean): void {
    this.pending.get(id)?.(confirmed);
  }

  /** Decline everything still waiting. */
  close(): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const settle of waiting) settle(false);
  }
}
