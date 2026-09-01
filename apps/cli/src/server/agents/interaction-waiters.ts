// One responsibility: the PENDING-INTERACTION WAITERS — the bridge between a
// provider process paused on a question and the row the answer route
// resolves. `park` creates the row (idempotent on the provider's request
// key) and parks the provider's promise on it; `resolve` answers the promise
// from the recorded resolution; `cancel` denies what is parked (a settle, a
// dispose). A parked wait belongs to the USER, so it carries its own clock
// ({@link INTERACTION_TIMEOUT_MS}); the turn watchdog is told when a wait
// settles so the provider's silence starts counting again from there.

import type { DbConnection } from "@repo/db/connection";
import {
  createPendingInteraction,
  interruptPendingInteraction,
  type CreatePendingInteractionInput,
} from "@repo/db/pending-interactions";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  approvalPendingInteractionPayloadSchema,
  parseApprovalResolution,
  type PendingInteractionCreate,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";

/** How long a parked approval waits on the user before the provider gets a
 *  deny and the row is interrupted. */
export const INTERACTION_TIMEOUT_MS = 30 * 60_000;

interface InteractionWaiter {
  threadId: string;
  payload: PendingInteractionPayload;
  resolve: (resolution: PendingInteractionResolution) => void;
}

export interface InteractionWaitersDeps {
  db: DbConnection;
  notifier: DbNotifier;
  debug(message: string): void;
  /** The thread's provider is free to work again (an answer, a timeout deny)
   *  — the turn watchdog restarts its silence clock from here. */
  onWaitSettled(threadId: string): void;
}

export interface InteractionWaiters {
  /** Create the row (idempotent on the provider's request key) and park the
   *  provider's promise until the answer route resolves it, the wait times
   *  out, or a cancel denies it. An already-resolved or interrupted row
   *  answers immediately. */
  park(
    create: PendingInteractionCreate,
    hostTurnId: string | null,
  ): Promise<PendingInteractionResolution>;
  /** The answer route resolved a row; answer the parked provider request
   *  from the recorded resolution. An unparseable resolution denies. */
  resolve(interaction: PendingInteraction): void;
  /** Deny every parked approval — for one thread (a settle; its rows are
   *  interrupted by the caller) or for all of them (dispose). */
  cancel(threadId?: string): void;
  /** True while an approval for this thread is parked on the user's answer. */
  hasParked(threadId: string): boolean;
}

export function createInteractionWaiters(deps: InteractionWaitersDeps): InteractionWaiters {
  const waitersByInteractionId = new Map<string, InteractionWaiter>();

  return {
    async park(create, hostTurnId) {
      const payload = approvalPendingInteractionPayloadSchema.parse(create.payload);
      const pending: CreatePendingInteractionInput = {
        threadId: create.threadId,
        requestKey: create.providerRequestId,
        payload: JSON.stringify(payload),
      };
      if (hostTurnId !== null) pending.turnId = hostTurnId;
      const row = createPendingInteraction(deps.db, deps.notifier, pending);
      if (row.status === "resolved" && row.resolution !== null) {
        const parsed = parseApprovalResolution(row.resolution, payload);
        return parsed.ok ? parsed.resolution : { decision: "deny" };
      }
      if (row.status === "interrupted") {
        return { decision: "deny" };
      }
      return new Promise<PendingInteractionResolution>((resolve) => {
        let settled = false;
        const settle = (resolution: PendingInteractionResolution): void => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(resolution);
        };
        const timer = setTimeout(() => {
          if (waitersByInteractionId.delete(row.id)) {
            interruptPendingInteraction(deps.db, deps.notifier, {
              id: row.id,
              threadId: create.threadId,
            });
            settle({ decision: "deny" });
            deps.onWaitSettled(create.threadId);
          }
        }, INTERACTION_TIMEOUT_MS);
        timer.unref();
        waitersByInteractionId.set(row.id, {
          threadId: create.threadId,
          payload,
          resolve: (resolution) => {
            clearTimeout(timer);
            settle(resolution);
            deps.onWaitSettled(create.threadId);
          },
        });
      });
    },

    resolve(interaction) {
      const waiter = waitersByInteractionId.get(interaction.id);
      if (waiter === undefined) {
        return;
      }
      waitersByInteractionId.delete(interaction.id);
      const parsed =
        interaction.resolution === null
          ? null
          : parseApprovalResolution(interaction.resolution, waiter.payload);
      if (parsed === null || !parsed.ok) {
        deps.debug(
          `interaction ${interaction.id} resolved with an unparseable resolution; denying the provider`,
        );
        waiter.resolve({ decision: "deny" });
        return;
      }
      waiter.resolve(parsed.resolution);
    },

    cancel(threadId) {
      // Snapshot first: the loop deletes entries mid-iteration.
      const waiters = Array.from(waitersByInteractionId);
      for (const [id, waiter] of waiters) {
        if (threadId !== undefined && waiter.threadId !== threadId) {
          continue;
        }
        waitersByInteractionId.delete(id);
        waiter.resolve({ decision: "deny" });
      }
    },

    hasParked(threadId) {
      for (const waiter of waitersByInteractionId.values()) {
        if (waiter.threadId === threadId) {
          return true;
        }
      }
      return false;
    },
  };
}
