import { Type, type Static } from "@sinclair/typebox";

import { WIDGET_SURFACES } from "@/shared/shell";
import { WidgetSpecParam } from "@/shared/widget-spec-schema";

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

export const ManageUiSchema = Type.Union([
  Type.Object({ action: Type.Literal("list") }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("catalog") }, { additionalProperties: false }),
  Type.Object(
    { action: Type.Literal("read"), id: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("install"),
      id: Type.Optional(Type.String({ minLength: 1 })),
      title: Type.String({ minLength: 1 }),
      description: Type.Optional(Type.String()),
      spec: WidgetSpecParam,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("update"),
      id: Type.String({ minLength: 1 }),
      expectedRevision: Type.Integer({ minimum: 1 }),
      title: Type.Optional(Type.String({ minLength: 1 })),
      description: Type.Optional(Type.String()),
      spec: WidgetSpecParam,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("patch"),
      id: Type.String({ minLength: 1 }),
      expectedRevision: Type.Integer({ minimum: 1 }),
      ops: Type.Array(PatchOpParam, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("delete"),
      id: Type.String({ minLength: 1 }),
      expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("place"),
      id: Type.String({ minLength: 1 }),
      surface: Type.Optional(SurfaceParam),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("unplace"), instanceId: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

export type ManageUiParams = Static<typeof ManageUiSchema>;
