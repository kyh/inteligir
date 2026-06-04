import { Type } from "@sinclair/typebox";

const GeometrySchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    w: Type.Number(),
    h: Type.Number(),
    minW: Type.Optional(Type.Number()),
    minH: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const RectSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number(),
    height: Type.Number(),
  },
  { additionalProperties: false },
);

// WidgetSpec is validated via parseWidgetSpec (TypeBox + cycle check) at the
// boundary that produces it (install/update/patch in shell.ts). The on-disk
// field is kept as Unknown here so a malformed spec on disk doesn't reject
// the whole shell — consumers parseWidgetSpec it on access.
const JsonUiDefSchema = Type.Object(
  {
    id: Type.String(),
    title: Type.String(),
    description: Type.Optional(Type.String()),
    revision: Type.Number(),
    singleton: Type.Literal(false),
    defaultGeometry: GeometrySchema,
    source: Type.Object(
      {
        kind: Type.Literal("json-ui"),
        spec: Type.Unknown(),
        createdAt: Type.Number(),
        updatedAt: Type.Number(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const PinnedPlacementSchema = Type.Object(
  { surface: Type.Literal("pinned"), geometry: GeometrySchema },
  { additionalProperties: false },
);

const FloatingPlacementSchema = Type.Object(
  { surface: Type.Literal("floating"), rect: RectSchema, z: Type.Number() },
  { additionalProperties: false },
);

const PlacementSchema = Type.Union([PinnedPlacementSchema, FloatingPlacementSchema]);

const WidgetInstanceSchema = Type.Object(
  {
    instanceId: Type.String(),
    widgetId: Type.String(),
    placement: PlacementSchema,
    state: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const ShellSchema = Type.Object(
  {
    version: Type.Literal(2),
    customDefs: Type.Array(JsonUiDefSchema),
    instances: Type.Array(WidgetInstanceSchema),
    archivedStates: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

