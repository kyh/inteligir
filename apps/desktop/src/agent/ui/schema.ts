import { Type, type Static } from "@sinclair/typebox";

import { WIDGET_SURFACES } from "@/shared/shell";
import { WidgetSpecParam } from "@/shared/widget-spec-schema";

// JSON Patch op shape — used by the "patch" action.
const PatchOpParam = Type.Union([
  Type.Object(
    { op: Type.Literal("add"), path: Type.String(), value: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal("replace"), path: Type.String(), value: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object({ op: Type.Literal("remove"), path: Type.String() }, { additionalProperties: false }),
]);

const SurfaceParam = Type.Union(WIDGET_SURFACES.map((surface) => Type.Literal(surface)));

// Flat object with an `action` discriminator. We previously expressed this
// as Type.Union([...Type.Object]) which TypeBox compiles to a top-level
// `anyOf` with no `type` field — and OpenAI rejects tool parameters that
// aren't `type: "object"` at the root, silently failing every agent turn.
// The execute handler validates required fields per action at runtime.
export const ManageUiSchema = Type.Object(
  {
    action: Type.Union(
      [
        Type.Literal("list"),
        Type.Literal("catalog"),
        Type.Literal("read"),
        Type.Literal("install"),
        Type.Literal("update"),
        Type.Literal("patch"),
        Type.Literal("delete"),
        Type.Literal("place"),
        Type.Literal("unplace"),
      ],
      {
        description:
          "What to do. Required fields per action: " +
          "read/delete/place needs 'id'; " +
          "install needs 'title' and 'spec' (and optionally 'id', 'description'); " +
          "update needs 'id', 'expectedRevision', 'spec' (optional 'title'/'description'); " +
          "patch needs 'id', 'expectedRevision', 'ops'; " +
          "unplace needs 'instanceId'; " +
          "list/catalog need no extra fields.",
      },
    ),
    id: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String()),
    spec: Type.Optional(WidgetSpecParam),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    ops: Type.Optional(Type.Array(PatchOpParam, { minItems: 1 })),
    surface: Type.Optional(SurfaceParam),
    instanceId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type ManageUiParams = Static<typeof ManageUiSchema>;
