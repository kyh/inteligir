// ---------------------------------------------------------------------------
// App lifecycle state types.
//
// APP LIFECYCLE ONLY — signing in is not an app phase and neither is provider
// login: reaching the workspace already means a Better Auth session, and
// AI-provider connection lives behind Settings → AI
// (`connectAiProvider`/`disconnectAiProvider`). Neither gates app entry.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Events — what a client may send over the `transition` channel. There is no
// internal half: the host answers a transition inline rather than running an
// effect queue that feeds itself.
// ---------------------------------------------------------------------------

export const AppEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("SETUP") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("RETRY") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("NEW_SESSION") }, { additionalProperties: false }),
]);

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
  // `prev` records what FAILED (the effect's provenance), not just where to
  // route the error UI: RETRY re-runs that effect.
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
