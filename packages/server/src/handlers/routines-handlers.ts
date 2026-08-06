import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerRoutinesHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "routines">,
): void {
  handle("listRoutines", () => services.routines.list());
  handle("upsertRoutine", (params) => services.routines.upsert(params));
  handle("deleteRoutine", (id) => services.routines.delete(id));
  handle("runRoutineNow", (id) => services.routines.runNow(id));
  handle("restoreRoutineRun", (id) => services.routines.restoreLastRun(id));
}
