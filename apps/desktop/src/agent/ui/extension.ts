// Spec validation is loose here — the renderer catalog does the strict
// prop-shape check at mount time, so a malformed spec surfaces as a render
// error rather than crashing the tool call.

import { Type, type Static } from "@sinclair/typebox";

import { flushRendererInstance } from "@/main/lib/widget-flush";
import { getShell } from "@/main/shell";
import { toErrorMessage } from "@/shared/ipc";
import { isBuiltin, isCustom, type WidgetSpec } from "@/shared/shell";
import type { PiExtensionBundle } from "@/agent/extension";

const SpecParam = Type.Object(
  {
    root: Type.String({ description: "Key of the root element in elements" }),
    elements: Type.Record(
      Type.String(),
      Type.Object(
        {
          type: Type.String({
            description:
              "Component type: Stack | Section | Row | Heading | Text | TextBlock | Button | Checkbox | Input | Textarea | Card | Separator",
          }),
          props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          children: Type.Optional(Type.Array(Type.String())),
          visible: Type.Optional(Type.Unknown()),
          on: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          watch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        },
        { additionalProperties: false },
      ),
    ),
    state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const pointerField = Type.String({ description: "JSON Pointer rooted at the spec" });

const PatchOpParam = Type.Union(
  [
    Type.Object(
      { op: Type.Literal("add"), path: pointerField, value: Type.Unknown() },
      { additionalProperties: false },
    ),
    Type.Object(
      { op: Type.Literal("replace"), path: pointerField, value: Type.Unknown() },
      { additionalProperties: false },
    ),
    Type.Object(
      { op: Type.Literal("remove"), path: pointerField },
      { additionalProperties: false },
    ),
  ],
  {
    description:
      "RFC 6902 patch op. Paths target the spec, e.g. '/elements/btn1/props/label'. " +
      "Use '-' as the last array segment to append.",
  },
);

const ManageUiSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("list"),
      Type.Literal("read"),
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("patch"),
      Type.Literal("delete"),
      Type.Literal("place"),
      Type.Literal("unplace"),
    ],
    { description: "Action to perform" },
  ),
  id: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Widget definition id. Required for read/update/patch/delete and for place " +
        "(a built-in id like 'tasks' or a custom widget id). Optional for create — " +
        "generated from title if omitted.",
    }),
  ),
  instanceId: Type.Optional(
    Type.String({ minLength: 1, description: "Placed instance id (required for unplace)" }),
  ),
  surface: Type.Optional(
    Type.Union([Type.Literal("pinned"), Type.Literal("floating")], {
      description:
        "Where to place a widget (for action='place'): 'pinned' (a desktop widget docked " +
        "on the grid) or 'floating' (an app window). Defaults to floating.",
    }),
  ),
  title: Type.Optional(
    Type.String({
      description: "Human-readable title shown as the panel header (required for create)",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "Optional short subtitle shown under the title" }),
  ),
  spec: Type.Optional(
    Type.Unsafe<WidgetSpec>({
      ...SpecParam,
      description:
        "json-render flat spec ({ root, elements }) — required for create, optional for update. " +
        "Components catalog: Stack/Section/Row/Heading/Text/TextBlock/Button/Checkbox/Input/Textarea/Card/Separator. " +
        "Wire buttons via on: { press: { action: 'notify', params: { message: 'Hi' } } }. " +
        "Bind inputs/checkboxes via { $bindState: '/path' }; use the built-in setState action to mutate state from buttons. " +
        "Actions: notify({message,variant}), openUrl({url}); and 'live' actions — " +
        "sendPrompt({prompt}) (sends a chat turn to the agent), " +
        "generateText({prompt,into,system?}) (one model call, writes text to state at `into`; bind a Text to it), " +
        "fetchUrl({url,into}) (HTTP GET into state at `into`).",
    }),
  ),
  state: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Optional initial bound-state values for a created widget.",
    }),
  ),
  ops: Type.Optional(
    Type.Array(PatchOpParam, {
      minItems: 1,
      description:
        "RFC 6902 patch operations (required for action='patch'). Applied in order, " +
        "result validated before writing. Cheaper than 'update' for targeted edits.",
    }),
  ),
});

const uiExtension: PiExtensionBundle = {
  name: "manage_ui",
  register: () => (pi) => {
    pi.registerTool({
      name: "manage_ui",
      label: "manage_ui",
      description:
        "Manage the user's workspace ('shell'), an OS-like grid of widgets. Widgets are " +
        "either built-in (chat, tasks, skills, extensions, settings) or custom panels you " +
        "generate from a JSON spec. A widget definition can be placed as zero, one, or many " +
        "instances on the grid; the user can drag, resize, and close instances. " +
        "Actions: 'list' (what exists + what's placed), 'read', 'create'/'update'/'patch'/" +
        "'delete' (custom definitions), 'place' (add an instance of a built-in or custom " +
        "widget), 'unplace' (remove a placed instance by instanceId).",
      parameters: ManageUiSchema,
      execute: async (_toolCallId, params: Static<typeof ManageUiSchema>) => {
        const text = (s: string) => ({
          content: [{ type: "text" as const, text: s }],
          details: {},
        });
        const mgr = getShell();
        try {
          switch (params.action) {
            case "list": {
              const { defs, instances } = mgr.snapshot();
              const builtins = defs.filter(isBuiltin);
              const customs = defs.filter(isCustom);
              const customLine = (d: typeof customs[number]) =>
                d.source.kind === "custom"
                  ? `  - ${d.id}: "${d.title}" (${Object.keys(d.source.spec.elements).length} elements)`
                  : `  - ${d.id}: "${d.title}"`;
              const available = [
                "Built-in widgets:",
                ...builtins.map((b) => `  - ${b.id}: "${b.title}"`),
                "Custom widgets:",
                ...(customs.length === 0 ? ["  (none)"] : customs.map(customLine)),
                "Placed instances:",
                ...(instances.length === 0
                  ? ["  (none)"]
                  : instances.map((i) => `  - ${i.instanceId} → ${i.widgetId}`)),
              ];
              return text(available.join("\n"));
            }
            case "read": {
              if (!params.id) return text("Error: id is required for action='read'");
              const def = mgr.getDef(params.id);
              if (!def) return text(`Error: no widget with id '${params.id}'`);
              return text(JSON.stringify(def, null, 2));
            }
            case "create": {
              if (!params.title) return text("Error: title is required for action='create'");
              if (!params.spec) return text("Error: spec is required for action='create'");
              if (params.id !== undefined && mgr.getDef(params.id)) {
                return text(
                  `Error: widget '${params.id}' already exists. Use action='update', or omit id.`,
                );
              }
              const { def, instance } = mgr.createWidget({
                id: params.id,
                title: params.title,
                description: params.description,
                spec: params.spec,
                state: params.state,
              });
              return text(`Created custom widget '${def.id}' and placed it (instance ${instance.instanceId}).`);
            }
            case "update": {
              if (!params.id) return text("Error: id is required for action='update'");
              if (!params.spec) return text("Error: spec is required for action='update'");
              const updated = mgr.updateWidget({
                id: params.id,
                title: params.title ?? mgr.getDef(params.id)?.title ?? params.id,
                description: params.description,
                spec: params.spec,
              });
              return text(`Updated custom widget '${updated.id}'.`);
            }
            case "patch": {
              if (!params.id) return text("Error: id is required for action='patch'");
              if (!params.ops || params.ops.length === 0) {
                return text("Error: ops is required for action='patch' (at least one operation)");
              }
              const patched = mgr.patchWidgetSpec({ id: params.id, ops: params.ops });
              return text(
                `Patched custom widget '${patched.id}' (${params.ops.length} op${params.ops.length === 1 ? "" : "s"}).`,
              );
            }
            case "delete": {
              if (!params.id) return text("Error: id is required for action='delete'");
              const deleted = mgr.deleteWidget(params.id);
              return text(
                deleted
                  ? `Deleted custom widget '${params.id}' and all its instances.`
                  : `No custom widget '${params.id}' to delete (built-ins can't be deleted).`,
              );
            }
            case "place": {
              if (!params.id) return text("Error: id is required for action='place'");
              const instance = mgr.placeWidget(params.id, params.surface);
              if (!instance) return text(`Error: no widget with id '${params.id}' to place`);
              return text(
                `Placed '${params.id}' as a ${instance.placement.surface} widget (instance ${instance.instanceId}).`,
              );
            }
            case "unplace": {
              if (!params.instanceId) {
                return text("Error: instanceId is required for action='unplace'");
              }
              // Let the renderer flush any pending debounced widget state
              // before we archive — otherwise the user's recent edits get
              // lost on re-place.
              await flushRendererInstance(params.instanceId);
              const removed = mgr.unplaceWidget(params.instanceId);
              return text(
                removed
                  ? `Unplaced instance '${params.instanceId}'.`
                  : `Cannot unplace '${params.instanceId}' — not found or permanent.`,
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
