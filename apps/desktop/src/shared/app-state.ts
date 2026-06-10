// ---------------------------------------------------------------------------
// App lifecycle state machine types
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// External events — sent by renderer via IPC
// ---------------------------------------------------------------------------

export const AppEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("LOGIN") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("SETUP") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("LOGOUT") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("RETRY") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("NEW_SESSION") }, { additionalProperties: false }),
]);

type AppEvent = Static<typeof AppEventSchema>;

// ---------------------------------------------------------------------------
// Internal events — emitted by effect runner, never from renderer
// ---------------------------------------------------------------------------

type InternalEvent =
  | { type: "LOGIN_OK" }
  | { type: "LOGIN_FAIL"; message: string }
  | { type: "SETUP_OK" }
  | { type: "SETUP_FAIL"; message: string }
  | { type: "LOGOUT_OK" }
  | { type: "LOGOUT_FAIL"; message: string }
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
  Type.Object({ phase: Type.Literal("logged_out") }, { additionalProperties: false }),
  Type.Object({ phase: Type.Literal("logging_in") }, { additionalProperties: false }),
  Type.Object({ phase: Type.Literal("logged_in") }, { additionalProperties: false }),
  Type.Object({ phase: Type.Literal("setting_up") }, { additionalProperties: false }),
  Type.Object(
    {
      phase: Type.Literal("ready"),
      agent: Type.Union([Type.Literal("idle"), Type.Literal("busy")]),
    },
    { additionalProperties: false },
  ),
  Type.Object({ phase: Type.Literal("logging_out") }, { additionalProperties: false }),
  Type.Object(
    {
      phase: Type.Literal("error"),
      prev: Type.Union([
        Type.Literal("logging_in"),
        Type.Literal("setting_up"),
        Type.Literal("ready"),
        Type.Literal("logging_out"),
      ]),
      message: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

export type AppState = Static<typeof AppStateSchema>;
