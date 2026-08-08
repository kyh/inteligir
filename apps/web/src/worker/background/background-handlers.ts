// ---------------------------------------------------------------------------
// The ten Bridge handlers over background work: delegation, routines, and the
// editor's post-turn undo.
//
// Thin, like every handler group here — what a channel MEANS lives in the store
// it calls. The one decision this module makes is which refusals are values and
// which are throws, and it follows the registry: every one of these channels
// declares an `{ok:false, error}` variant, so nothing below throws for a
// refusal a user can act on.
// ---------------------------------------------------------------------------

import type { RestoreAgentEditsResult } from "@repo/bridge/agent-actions";

import type { AgentSnapshots } from "../agent/agent-snapshots";
import type { HandlerRegistrar } from "../host/handler-registry";
import type { Delegations } from "./delegations";
import type { Routines } from "./routines";

export type BackgroundServices = {
  readonly delegations: Delegations;
  readonly routines: Routines;
  readonly snapshots: AgentSnapshots;
};

export function registerBackgroundHandlers(
  handle: HandlerRegistrar,
  services: BackgroundServices,
): void {
  // A delegation the USER created carries no turn id: the per-turn cap exists
  // to stop an agent queueing its own successors, and a person clicking
  // "Delegate" is not that.
  handle("createDelegation", (params) => services.delegations.create(params, null));
  handle("listDelegations", () => services.delegations.list());
  handle("cancelDelegation", (id) => services.delegations.cancel(id));
  handle("restoreDelegationSnapshot", (id) => services.delegations.restoreSnapshot(id));

  handle("listRoutines", () => services.routines.list());
  handle("upsertRoutine", (params) => services.routines.upsert(params));
  handle("deleteRoutine", (id) => services.routines.delete(id));
  handle("runRoutineNow", (id) => services.routines.runNow(id));
  handle("restoreRoutineRun", (id) => services.routines.restoreLastRun(id));

  // The chat undo toast. Scoped to `chat` captures on purpose: a background
  // task's edits have their own affordance behind their own run-state guard,
  // and this one must not reach around it.
  handle("restoreAgentEdits", async ({ ids }): Promise<RestoreAgentEditsResult> => {
    const restored = await services.snapshots.restore(ids, "chat");
    return restored.ok ? { ok: true } : { ok: false, error: restored.reason };
  });
}
