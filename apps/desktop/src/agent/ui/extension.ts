import { Type, type Static } from "@sinclair/typebox";

import { deleteWithFlush, unplaceWithFlush } from "@/main/lib/shell-actions";
import { getShell } from "@/main/shell";
import { toErrorMessage } from "@/shared/ipc";
import { JSON_WIDGET_COMPONENT_TYPES, WIDGET_ACTION_NAMES } from "@/shared/widget-spec";
import { isBuiltin, isJsonUi } from "@/shared/shell";
import type { PiExtensionBundle } from "@/agent/extension";

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

const ManageUiSchema = Type.Union([
  Type.Object({ action: Type.Literal("list") }, { additionalProperties: false }),
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

type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, never>;
};

function text(content: string): ToolTextResult {
  return {
    content: [{ type: "text", text: content }],
    details: {},
  };
}

const uiExtension: PiExtensionBundle = {
  name: "manage_ui",
  register: () => (pi) => {
    pi.registerTool({
      name: "manage_ui",
      label: "manage_ui",
      description:
        "Manage the user's runtime UI. Built-in widgets are system React widgets; generated " +
        "widgets are json-ui specs. Install means the widget exists in the dock; place opens " +
        "an instance on the shell. Generated widgets are trusted and can use live actions.",
      parameters: ManageUiSchema,
      execute: async (_toolCallId, params: Static<typeof ManageUiSchema>) => {
        const mgr = getShell();
        try {
          switch (params.action) {
            case "list": {
              const { defs, instances } = mgr.snapshot();
              const builtins = defs.filter(isBuiltin);
              const generated = defs.filter(isJsonUi);
              const generatedLines = generated.map(
                (d) => `  - ${d.id}: "${d.title}" rev ${d.revision}`,
              );
              return text(
                [
                  "Built-in widgets:",
                  ...builtins.map((b) => `  - ${b.id}: "${b.title}"`),
                  "Generated widgets:",
                  ...(generatedLines.length === 0 ? ["  (none)"] : generatedLines),
                  "Placed instances:",
                  ...(instances.length === 0
                    ? ["  (none)"]
                    : instances.map((i) => `  - ${i.instanceId} -> ${i.widgetId}`)),
                ].join("\n"),
              );
            }
            case "read": {
              const def = mgr.getDef(params.id);
              return def
                ? text(JSON.stringify(def, null, 2))
                : text(`Error: no widget '${params.id}'`);
            }
            case "install": {
              const def = mgr.installWidget({
                id: params.id,
                title: params.title,
                description: params.description,
                spec: params.spec,
              });
              return text(
                `Installed generated widget '${def.id}' rev ${def.revision}. Use action='place' to open it.`,
              );
            }
            case "update": {
              const def = mgr.updateWidget({
                id: params.id,
                expectedRevision: params.expectedRevision,
                title: params.title,
                description: params.description,
                spec: params.spec,
              });
              return text(`Updated generated widget '${def.id}' to rev ${def.revision}.`);
            }
            case "patch": {
              const def = mgr.patchWidgetSpec({
                id: params.id,
                expectedRevision: params.expectedRevision,
                ops: params.ops,
              });
              return text(`Patched generated widget '${def.id}' to rev ${def.revision}.`);
            }
            case "delete": {
              const deleted = await deleteWithFlush(params.id, params.expectedRevision);
              return text(
                deleted
                  ? `Deleted generated widget '${params.id}'.`
                  : `No generated widget '${params.id}'.`,
              );
            }
            case "place": {
              const instance = mgr.placeWidget(params.id, params.surface);
              return instance
                ? text(
                    `Placed '${params.id}' as ${instance.placement.surface} instance ${instance.instanceId}.`,
                  )
                : text(`Error: no widget '${params.id}'`);
            }
            case "unplace": {
              const removed = await unplaceWithFlush(params.instanceId);
              return text(
                removed
                  ? `Unplaced '${params.instanceId}'.`
                  : `Cannot unplace '${params.instanceId}'.`,
              );
            }
          }
        } catch (err) {
          return text(`Error: ${toErrorMessage(err)}`);
        }
      },
    });
  },
};

export default uiExtension;
