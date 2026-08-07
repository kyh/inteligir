// ---------------------------------------------------------------------------
// Persisted renderer UI state — a generic key→JSON map saved to disk in the
// main process (~/.inteligir/ui-state.json). Backs panel layout, open panels,
// and any other view preference the renderer wants to survive restarts.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

export const UiStateSchema = Type.Record(Type.String(), Type.Unknown());

export type UiState = Static<typeof UiStateSchema>;

/**
 * The key the open note persists under (a path string, or null for none).
 *
 * The one key in this map spelled on BOTH sides. The UI owns it in the ordinary
 * case, but a host that seeds a brand-new workspace has to say which of the
 * files it just wrote is the one to land on — and a second copy of the string
 * is how the seeded note ends up ignored.
 */
export const UI_STATE_OPEN_NOTE_KEY = "workspace.openNote";

export const UiStateSetSchema = Type.Object(
  { key: Type.String({ minLength: 1 }), value: Type.Unknown() },
  { additionalProperties: false },
);
