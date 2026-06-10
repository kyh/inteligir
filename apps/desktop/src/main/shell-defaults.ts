import { SEED_WIDGET_DEFS, SEED_WIDGET_INSTANCES } from "@/main/seed-widgets";
import { BUILTIN_DEFS, type Shell, type ShellSnapshot } from "@/shared/shell";

// Only the seven patina-style dashboard widgets are pinned on first run.
// Every built-in (chat / widgets / tasks / extensions / settings) is
// launchable from the dock when the user wants it, but the grid starts as a
// pure dashboard surface.
export const DEFAULT_SHELL: Shell = {
  version: 2,
  customDefs: [...SEED_WIDGET_DEFS],
  instances: [...SEED_WIDGET_INSTANCES],
  archivedStates: {},
};

export function shellSnapshot(shell: Shell): ShellSnapshot {
  return {
    defs: [...BUILTIN_DEFS, ...shell.customDefs],
    instances: shell.instances,
  };
}

export function defaultShellSnapshot(): ShellSnapshot {
  return {
    defs: [...BUILTIN_DEFS, ...SEED_WIDGET_DEFS],
    instances: structuredClone(SEED_WIDGET_INSTANCES),
  };
}
