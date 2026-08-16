// ---------------------------------------------------------------------------
// The scripted container's queued turns — how a headless drive says what the
// agent will answer, without a provider account. Only AGENT_RUNTIME=scripted
// answers the channel that carries this; every production path around it is
// the real one.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

// One step per assistant turn — optional text, optional tool calls (e.g. the
// write-back a delegation performs), and optional file writes, which are what
// the agent's OWN file tools do and reach the vault of record as a reported
// write rather than as a tool call.
export const FauxAgentScriptSchema = Type.Object(
  {
    steps: Type.Array(
      Type.Object(
        {
          text: Type.Optional(Type.String()),
          toolCalls: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  name: Type.String({ minLength: 1 }),
                  arguments: Type.Record(Type.String(), Type.Unknown()),
                },
                { additionalProperties: false },
              ),
            ),
          ),
          writes: Type.Optional(
            Type.Array(
              Type.Object(
                { path: Type.String({ minLength: 1 }), text: Type.String() },
                { additionalProperties: false },
              ),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type FauxAgentScript = Static<typeof FauxAgentScriptSchema>;
