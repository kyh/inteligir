// ---------------------------------------------------------------------------
// App lifecycle state machine types
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// External events — sent by renderer via IPC
// ---------------------------------------------------------------------------

export const AppEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("LOGIN") }),
  z.object({ type: z.literal("SETUP") }),
  z.object({ type: z.literal("LOGOUT") }),
  z.object({ type: z.literal("RETRY") }),
  z.object({ type: z.literal("NEW_SESSION") }),
]);

export type AppEvent = z.infer<typeof AppEventSchema>;

// ---------------------------------------------------------------------------
// Internal events — emitted by effect runner, never from renderer
// ---------------------------------------------------------------------------

export type InternalEvent =
  | { type: "LOGIN_OK" }
  | { type: "LOGIN_FAIL"; message: string }
  | { type: "SETUP_OK" }
  | { type: "SETUP_FAIL"; message: string }
  | { type: "LOGOUT_OK" }
  | { type: "AGENT_START" }
  | { type: "AGENT_END" }
  | { type: "NEW_SESSION_OK" };

/** All events the machine can process — external + internal */
export type MachineEvent = AppEvent | InternalEvent;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

export const AppStateSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("logged_out") }),
  z.object({ phase: z.literal("logging_in") }),
  z.object({ phase: z.literal("logged_in") }),
  z.object({ phase: z.literal("setting_up") }),
  z.object({ phase: z.literal("ready"), agent: z.enum(["idle", "busy"]) }),
  z.object({ phase: z.literal("logging_out") }),
  z.object({
    phase: z.literal("error"),
    prev: z.enum(["logging_in", "setting_up", "ready"]),
    message: z.string(),
  }),
]);

export type AppState = z.infer<typeof AppStateSchema>;
