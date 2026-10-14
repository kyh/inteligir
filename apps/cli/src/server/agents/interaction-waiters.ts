import type { DbConnection } from "@repo/db/connection";
import {
  createPendingInteraction,
  interruptPendingInteraction,
} from "@repo/db/pending-interactions";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  approvalPendingInteractionPayloadSchema,
  unanswerableReason,
} from "@repo/domain/pending-interactions";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/contract/local/threads/threads-schema";

export const INTERACTION_TIMEOUT_MS = 30 * 60_000;

interface InteractionWaiter {
  threadId: string;
  payload: ApprovalPendingInteractionPayload;
  resolve: (resolution: PendingInteractionResolution) => void;
}

export interface InteractionWaitersDeps {
  db: DbConnection;
  notifier: DbNotifier;
  debug: (message: string) => void;
  // the turn watchdog restarts its silence clock here: a parked wait is the user's time, not the provider's.
  onWaitSettled: (threadId: string) => void;
}

export interface InteractionWaiters {
  park: (create: PendingInteractionCreate) => Promise<PendingInteractionResolution>;
  resolve: (interaction: PendingInteraction) => void;
  cancel: (threadId?: string) => void;
  hasParked: (threadId: string) => boolean;
}

export const createInteractionWaiters = (deps: InteractionWaitersDeps): InteractionWaiters => {
  const waitersByInteractionId = new Map<string, InteractionWaiter>();

  return {
    cancel(threadId) {
      // snapshot first: the loop deletes entries mid-iteration.
      const waiters = [...waitersByInteractionId];
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

    async park(create) {
      const payload = approvalPendingInteractionPayloadSchema.parse(create.payload);
      const row = createPendingInteraction(deps.db, deps.notifier, {
        payload,
        requestKey: create.providerRequestId,
        threadId: create.threadId,
        turnId: create.turnId,
      });
      if (row.status === "resolved" && row.decision !== null) {
        return unanswerableReason(payload, row.decision) === null
          ? { decision: row.decision }
          : { decision: "deny" };
      }
      if (row.status === "interrupted") {
        return { decision: "deny" };
      }
      // the approval arrives on another request, or the timeout answers it.
      const { promise, resolve } = Promise.withResolvers<PendingInteractionResolution>();
      const timer = setTimeout(() => {
        if (waitersByInteractionId.delete(row.id)) {
          interruptPendingInteraction(deps.db, deps.notifier, {
            id: row.id,
            threadId: create.threadId,
          });
          resolve({ decision: "deny" });
          deps.onWaitSettled(create.threadId);
        }
      }, INTERACTION_TIMEOUT_MS);
      timer.unref();
      waitersByInteractionId.set(row.id, {
        payload,
        resolve: (resolution) => {
          clearTimeout(timer);
          resolve(resolution);
          deps.onWaitSettled(create.threadId);
        },
        threadId: create.threadId,
      });
      return await promise;
    },

    resolve(interaction) {
      const waiter = waitersByInteractionId.get(interaction.id);
      if (waiter === undefined) {
        return;
      }
      waitersByInteractionId.delete(interaction.id);
      const { decision } = interaction;
      if (decision === null || unanswerableReason(waiter.payload, decision) !== null) {
        deps.debug(
          `interaction ${interaction.id} resolved with a decision the request did not offer; denying the provider`,
        );
        waiter.resolve({ decision: "deny" });
        return;
      }
      waiter.resolve({ decision });
    },
  };
};
