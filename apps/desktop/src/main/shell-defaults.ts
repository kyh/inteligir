import {
  BUILTIN_DEFS,
  type Shell,
  type ShellSnapshot,
  type WidgetDef,
  type WidgetInstance,
} from "@/shared/shell";

function seedInstance(def: WidgetDef): WidgetInstance {
  return {
    instanceId: def.id,
    widgetId: def.id,
    placement: { surface: "pinned", geometry: { ...def.defaultGeometry } },
    state: {},
  };
}

const PERMANENT_DEFS = BUILTIN_DEFS.filter((d) => d.permanent);

export const DEFAULT_SHELL: Shell = {
  version: 2,
  customDefs: [],
  instances: PERMANENT_DEFS.map(seedInstance),
  archivedStates: {},
};

export function withPermanentInstances(shell: Shell): Shell {
  const missing = PERMANENT_DEFS.filter((d) => !shell.instances.some((i) => i.widgetId === d.id));
  return missing.length === 0
    ? shell
    : { ...shell, instances: [...missing.map(seedInstance), ...shell.instances] };
}

export function shellSnapshot(shell: Shell): ShellSnapshot {
  const safe = withPermanentInstances(shell);
  return {
    defs: [...BUILTIN_DEFS, ...safe.customDefs],
    instances: safe.instances,
  };
}

export function defaultShellSnapshot(): ShellSnapshot {
  return {
    defs: [...BUILTIN_DEFS],
    instances: structuredClone(DEFAULT_SHELL.instances),
  };
}
