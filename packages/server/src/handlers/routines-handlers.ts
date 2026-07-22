import { getRoutinesManager } from "../routines/routines-manager";
import type { HandlerRegistrar } from "./handler-registry";

export function registerRoutinesHandlers(handle: HandlerRegistrar): void {
  handle("listRoutines", () => getRoutinesManager().list());
  handle("upsertRoutine", (params) => getRoutinesManager().upsert(params));
  handle("deleteRoutine", (id) => getRoutinesManager().delete(id));
  handle("runRoutineNow", (id) => getRoutinesManager().runNow(id));
  handle("restoreRoutineRun", (id) => getRoutinesManager().restoreLastRun(id));
}
