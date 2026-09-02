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
  // the turn watchdog restarts its silence clock here: a parked wait is the user's time, not the provider's.
  onWaitSettled(threadId: string): void;
}

export interface InteractionWaiters {
  park(
    create: PendingInteractionCreate,
    hostTurnId: string | null,
  ): Promise<PendingInteractionResolution>;
  resolve(interaction: PendingInteraction): void;
  cancel(threadId?: string): void;
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
      // snapshot first: the loop deletes entries mid-iteration.
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
