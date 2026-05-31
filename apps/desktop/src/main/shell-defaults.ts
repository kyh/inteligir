import {
  BUILTIN_DEFS,
  builtinDef,
  CHAT_WIDGET_ID,
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

// Chat is the only widget seeded on first run — every other built-in starts
// off the grid and is launched from the dock when the user wants it.
const SEED_INSTANCES: WidgetInstance[] = (() => {
  const chat = builtinDef(CHAT_WIDGET_ID);
  return chat ? [seedInstance(chat)] : [];
})();

export const DEFAULT_SHELL: Shell = {
  version: 2,
  customDefs: [],
  instances: SEED_INSTANCES,
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
    defs: [...BUILTIN_DEFS],
    instances: structuredClone(DEFAULT_SHELL.instances),
  };
}
