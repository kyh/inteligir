// ---------------------------------------------------------------------------
// The RUNTIME check for the three payloads the object drives this daemon with.
//
// The types in ./protocol are the contract; these schemas are what proves an
// arriving body matches one. They are tied together by ASSIGNMENT rather than
// by comment — each parser returns the protocol type, so a schema that drifts
// from the contract fails to compile.
//
// Split from the daemon so the checks can be driven without a process: this is
// the boundary an object on the other side of an HTTP hop reaches, and every
// handler behind it assumes it held.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { ContainerBoot, ContainerTurn, ContainerVaultPush } from "./protocol";

const OBJECT = { additionalProperties: false } as const;

const BootSchema = Type.Object(
  {
    bootId: Type.String({ minLength: 1 }),
    reportUrl: Type.String(),
    reportToken: Type.String(),
    provider: Type.Object(
      {
        provider: Type.String({ minLength: 1 }),
        modelId: Type.String({ minLength: 1 }),
        baseUrl: Type.String({ minLength: 1 }),
        apiKey: Type.String(),
      },
      OBJECT,
    ),
    tools: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1 }),
          description: Type.String(),
          parameters: Type.Unknown(),
        },
        OBJECT,
      ),
    ),
    instructions: Type.String(),
    browserCdpUrl: Type.Union([Type.String(), Type.Null()]),
    browserCdpToken: Type.Union([Type.String(), Type.Null()]),
  },
  OBJECT,
);

const VaultPushSchema = Type.Object(
  {
    toRevision: Type.Number(),
    replaceAll: Type.Boolean(),
    upserted: Type.Array(
      Type.Object({ path: Type.String({ minLength: 1 }), bytesBase64: Type.String() }, OBJECT),
    ),
    removed: Type.Array(Type.String({ minLength: 1 })),
  },
  OBJECT,
);

const TurnSchema = Type.Object(
  {
    turnId: Type.String({ minLength: 1 }),
    kind: Type.Union([
      Type.Literal("user_message"),
      Type.Literal("steer"),
      Type.Literal("follow_up"),
    ]),
    text: Type.String(),
    images: Type.Array(Type.Object({ data: Type.String(), mimeType: Type.String() }, OBJECT)),
    seed: Type.Array(
      Type.Object(
        {
          role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
          text: Type.String(),
        },
        OBJECT,
      ),
    ),
  },
  OBJECT,
);

export function parseBoot(body: unknown): ContainerBoot | null {
  return Value.Check(BootSchema, body) ? body : null;
}

export function parseVaultPush(body: unknown): ContainerVaultPush | null {
  return Value.Check(VaultPushSchema, body) ? body : null;
}

export function parseTurn(body: unknown): ContainerTurn | null {
  return Value.Check(TurnSchema, body) ? body : null;
}
