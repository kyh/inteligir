// ---------------------------------------------------------------------------
// JSON-driven settings UI spec + state, persisted to ~/.inteligir/ui-settings.json
//
// The desktop settings panel is rendered from a json-render Spec stored on
// disk. The LLM can rewrite the spec via the `modify_ui_settings` tool;
// users can reset to defaults from the panel itself.
//
// Persistence shape:
//   {
//     version: 1,
//     spec:  Spec   // json-render flat tree
//     state: object // mutable values bound via $bindState (e.g. checkbox checked)
//   }
//
// Only the spec is LLM-controlled. State is owned by the runtime — checkboxes
// and other bound inputs read app facts (notification on/off, etc.) into state
// at mount, then push changes back through their normal IPC handlers.
// ---------------------------------------------------------------------------

import { z } from "zod";

import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { IPC_CHANNELS } from "@/shared/ipc";
import {
  DEFAULT_UI_SETTINGS_SPEC,
  type UiSettingsConfig,
  type UiSpec,
} from "@/shared/ui-settings";

// The on-disk spec is schema-validated only loosely — json-render does its own
// strict validation against the catalog at render time, so the store accepts
// any well-formed object shape and lets bad specs surface in the renderer.
const ElementSchema = z.looseObject({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
});

const SpecSchema = z.object({
  root: z.string(),
  elements: z.record(z.string(), ElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
});

const UiSettingsSchema = z.object({
  version: z.literal(1),
  spec: SpecSchema,
  state: z.record(z.string(), z.unknown()),
});

type StoredUiSettings = {
  version: 1;
  spec: UiSpec;
  state: Record<string, unknown>;
};

export type UiSettings = StoredUiSettings;

const DEFAULTS: UiSettings = {
  version: 1,
  spec: DEFAULT_UI_SETTINGS_SPEC,
  state: {},
};

export class UiSettingsManager {
  private readonly store: JsonStore<StoredUiSettings>;

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("ui-settings.json"),
      // The Zod parse output is structurally compatible with StoredUiSettings
      // (props gets a default {}, children stays optional) — cast away the
      // narrower inferred element type so the store generic stays explicit.
      UiSettingsSchema as unknown as z.ZodType<StoredUiSettings>,
      DEFAULTS,
    );
  }

  get(): UiSettingsConfig {
    const { spec, state } = this.store.read();
    return { spec, state };
  }

  setSpec(spec: UiSpec): UiSettingsConfig {
    const next = this.store.update((current) => ({ ...current, spec }));
    this.broadcast(next);
    return { spec: next.spec, state: next.state };
  }

  reset(): UiSettingsConfig {
    this.store.write(DEFAULTS);
    this.broadcast(DEFAULTS);
    return { spec: DEFAULTS.spec, state: DEFAULTS.state };
  }

  invalidate(): void {
    this.store.invalidate();
  }

  private broadcast(next: StoredUiSettings): void {
    broadcastToRenderer(IPC_CHANNELS.UI_SETTINGS_UPDATED, {
      spec: next.spec,
      state: next.state,
    });
  }
}

let _instance: UiSettingsManager | null = null;

export function getUiSettings(): UiSettingsManager {
  if (!_instance) _instance = new UiSettingsManager();
  return _instance;
}

export function resetUiSettingsCache(): void {
  _instance?.invalidate();
}
