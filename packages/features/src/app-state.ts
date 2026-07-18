// ---------------------------------------------------------------------------
// App lifecycle state machine types.
//
// The machine models APP LIFECYCLE ONLY — provider login is NOT an app phase
// (auth Phase 2, #459): the app boots as a guest straight toward the
// workspace; AI-provider connection lives in the provider layer (Settings →
// AI, `connectAiProvider`/`disconnectAiProvider`) and the optional account
// (Better Auth) lives in the sync layer. Neither gates app entry.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// External events — sent by renderer via IPC
// ---------------------------------------------------------------------------

export const AppEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("SETUP") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("RESET_APP_DATA") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("RETRY") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("NEW_SESSION") }, { additionalProperties: false }),
]);

type AppEvent = Static<typeof AppEventSchema>;

// ---------------------------------------------------------------------------
// Internal events — emitted by effect runner, never from renderer
// ---------------------------------------------------------------------------

type InternalEvent =
  | { type: "SETUP_OK" }
  | { type: "SETUP_FAIL"; message: string }
  | { type: "AGENT_START" }
  | { type: "AGENT_END" }
  | { type: "NEW_SESSION_OK" }
  | { type: "NEW_SESSION_FAIL"; message: string };

/** All events the machine can process — external + internal */
export type MachineEvent = AppEvent | InternalEvent;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

export const AppStateSchema = Type.Union([
  // Waiting for the first SETUP trigger. Warm boots leave it immediately
  // (initMachine auto-fires SETUP when setup is already complete); a genuine
  // first run lingers here until the onboarding surface fires SETUP.
  Type.Object({ phase: Type.Literal("starting") }, { additionalProperties: false }),
  Type.Object({ phase: Type.Literal("setting_up") }, { additionalProperties: false }),
  Type.Object(
    {
      phase: Type.Literal("ready"),
      agent: Type.Union([Type.Literal("idle"), Type.Literal("busy")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      phase: Type.Literal("error"),
      prev: Type.Union([Type.Literal("setting_up"), Type.Literal("ready")]),
      message: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

export type AppState = Static<typeof AppStateSchema>;
