import { Type, type Static } from "@sinclair/typebox";

import { flushRendererInstance } from "@/main/lib/widget-flush";
import { getShell } from "@/main/shell";
import { toErrorMessage } from "@/shared/ipc";
import { isBuiltin, isJsonUi, type WidgetSpec } from "@/shared/shell";
import type { PiExtensionBundle } from "@/agent/extension";

const SpecParam = Type.Object(
  {
    root: Type.String({ description: "Key of the root element in elements" }),
    elements: Type.Record(
      Type.String(),
      Type.Object(
        {
          type: Type.Union([
            Type.Literal("Stack"),
            Type.Literal("Section"),
            Type.Literal("Row"),
            Type.Literal("Heading"),
            Type.Literal("Text"),
            Type.Literal("TextBlock"),
            Type.Literal("Button"),
            Type.Literal("Checkbox"),
            Type.Literal("Input"),
            Type.Literal("Textarea"),
            Type.Literal("Card"),
            Type.Literal("Separator"),
          ]),
          props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          children: Type.Optional(Type.Array(Type.String())),
          visible: Type.Optional(Type.Unknown()),
          on: Type.Optional(
            Type.Record(
              Type.String(),
              Type.Object({
                action: Type.Union([
                  Type.Literal("notify"),
                  Type.Literal("openUrl"),
                  Type.Literal("sendPrompt"),
                  Type.Literal("generateText"),
                  Type.Literal("fetchUrl"),
                  Type.Literal("setState"),
                ]),
                params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
              }),
            ),
          ),
          watch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
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
      spec: Type.Unsafe<WidgetSpec>(SpecParam),
      state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("update"),
      id: Type.String({ minLength: 1 }),
      expectedRevision: Type.Number({ minimum: 1 }),
      title: Type.Optional(Type.String({ minLength: 1 })),
      description: Type.Optional(Type.String()),
      spec: Type.Unsafe<WidgetSpec>(SpecParam),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("patch"),
      id: Type.String({ minLength: 1 }),
      expectedRevision: Type.Number({ minimum: 1 }),
      ops: Type.Array(PatchOpParam, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("delete"),
      id: Type.String({ minLength: 1 }),
      expectedRevision: Type.Number({ minimum: 1 }),
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
                state: params.state,
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
              // Flush every live viewer of this def first so a post-delete
              // unmount-time setInstanceState doesn't fire against an instance
              // that's already gone.
              const live = mgr.snapshot().instances.filter((i) => i.widgetId === params.id);
              await Promise.all(live.map((i) => flushRendererInstance(i.instanceId)));
              const deleted = mgr.deleteWidget(params.id, params.expectedRevision);
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
              // Let the renderer flush any pending debounced widget state
              // before we archive — otherwise the user's recent edits get
              // lost on re-place.
              await flushRendererInstance(params.instanceId);
              const removed = mgr.unplaceWidget(params.instanceId);
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
