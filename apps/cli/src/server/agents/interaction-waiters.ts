// A turn parked on a question the user answers: the row the panel and the phone draw, and the
// promise its driver awaits until that row is resolved, interrupted or times out. The scripted
// driver parks here today, and the observer's hook wait (Claude's PermissionRequest) is the seam's
// next caller.

import type { DbConnection } from "@repo/db/connection";
import {
  createPendingInteraction,
  interruptPendingInteraction,
} from "@repo/db/pending-interactions";
import type { CreatePendingInteractionInput } from "@repo/db/pending-interactions";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  approvalPendingInteractionPayloadSchema,
  parseApprovalResolution,
} from "@repo/domain/pending-interactions";
import type {
  PendingInteractionCreate,
  PendingInteractionPayload,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/contract/local/threads/threads-schema";

export const INTERACTION_TIMEOUT_MS = 30 * 60_000;

interface InteractionWaiter {
  threadId: string;
  payload: PendingInteractionPayload;
  resolve: (resolution: PendingInteractionResolution) => void;
}

export interface InteractionWaitersDeps {
  db: DbConnection;
  notifier: DbNotifier;
  debug: (message: string) => void;
}

export interface InteractionWaiters {
  park: (
    create: PendingInteractionCreate,
    hostTurnId: string | null,
  ) => Promise<PendingInteractionResolution>;
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

    async park(create, hostTurnId) {
      const payload = approvalPendingInteractionPayloadSchema.parse(create.payload);
      const pending: CreatePendingInteractionInput = {
        payload: JSON.stringify(payload),
        requestKey: create.providerRequestId,
        threadId: create.threadId,
      };
      if (hostTurnId !== null) {
        pending.turnId = hostTurnId;
      }
      const row = createPendingInteraction(deps.db, deps.notifier, pending);
      if (row.status === "resolved" && row.resolution !== null) {
        const parsed = parseApprovalResolution(row.resolution, payload);
        return parsed.ok ? parsed.resolution : { decision: "deny" };
      }
      if (row.status === "interrupted") {
        return { decision: "deny" };
      }
      // oxlint-disable-next-line promise/avoid-new -- bridges the approval that arrives on another request, or the timeout
      return await new Promise<PendingInteractionResolution>((resolve) => {
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
          }
        }, INTERACTION_TIMEOUT_MS);
        timer.unref();
        waitersByInteractionId.set(row.id, {
          payload,
          resolve: (resolution) => {
            clearTimeout(timer);
            settle(resolution);
          },
          threadId: create.threadId,
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
  };
};
