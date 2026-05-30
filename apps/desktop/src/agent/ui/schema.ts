import { Type, type Static } from "@sinclair/typebox";

import { JSON_WIDGET_COMPONENT_TYPES, WIDGET_ACTION_NAMES } from "@/shared/widget-spec";

function literalUnion<T extends string>(values: readonly T[]) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const ComponentTypeParam = literalUnion(JSON_WIDGET_COMPONENT_TYPES);
const ActionNameParam = literalUnion(WIDGET_ACTION_NAMES);

const ActionRequestParam = Type.Object(
  {
    action: ActionNameParam,
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const ActionBindingParam = Type.Union([ActionRequestParam, Type.Array(ActionRequestParam)]);

const SpecParam = Type.Object(
  {
    root: Type.String({ description: "Key of the root element in elements" }),
    elements: Type.Record(
      Type.String(),
      Type.Object(
        {
          type: ComponentTypeParam,
          props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          children: Type.Optional(Type.Array(Type.String())),
          visible: Type.Optional(Type.Unknown()),
          repeat: Type.Optional(
            Type.Object(
              {
                statePath: Type.String(),
                key: Type.Optional(Type.String()),
              },
              { additionalProperties: false },
            ),
          ),
          on: Type.Optional(Type.Record(Type.String(), ActionBindingParam)),
          watch: Type.Optional(Type.Record(Type.String(), ActionBindingParam)),
        },
        { additionalProperties: false },
      ),
    ),
    state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

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
      spec: SpecParam,
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
      spec: SpecParam,
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
      expectedRevision: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("place"),
      id: Type.String({ minLength: 1 }),
      surface: Type.Optional(Type.Union([Type.Literal("pinned"), Type.Literal("floating")])),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("unplace"), instanceId: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

export type ManageUiParams = Static<typeof ManageUiSchema>;
