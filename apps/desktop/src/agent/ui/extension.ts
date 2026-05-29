// Spec validation is loose here — the renderer catalog does the strict
// prop-shape check at mount time, so a malformed spec surfaces as a render
// error rather than crashing the tool call.

import { Type, type Static } from "@sinclair/typebox";

import { getShell } from "@/main/shell";
import { toErrorMessage } from "@/shared/ipc";
import { isArtifactWidget } from "@/shared/shell";
import type { ArtifactSpec } from "@/shared/artifacts";
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
              "Component type: Stack | Section | Row | Heading | Text | TextBlock | Button | Checkbox | Input | Card | Separator",
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
      Type.Literal("remove"),
    ],
    { description: "Action to perform" },
  ),
  id: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Widget id (required for read/update/patch/remove; optional for create — generated from title if omitted)",
    }),
  ),
  title: Type.Optional(
    Type.String({
      description:
        "Human-readable title shown as the panel header in the workspace (required for create)",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "Optional short subtitle shown under the title" }),
  ),
  spec: Type.Optional(
    Type.Unsafe<ArtifactSpec>({
      ...SpecParam,
      description:
        "json-render flat spec ({ root, elements }) — required for create, optional for update. " +
        "Components catalog: Stack/Section/Row/Heading/Text/TextBlock/Button/Checkbox/Input/Card/Separator. " +
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
      description:
        "Optional initial bound-state values. Omit to preserve existing state on update, or seed {} on create.",
    }),
  ),
  ops: Type.Optional(
    Type.Array(PatchOpParam, {
      minItems: 1,
      description:
        "RFC 6902 patch operations (required for action='patch'). Applied in order, " +
        "result validated against the catalog before writing. Use 'patch' instead of " +
        "'update' for targeted edits on large specs — saves tokens vs. resending the " +
        "whole tree.",
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
        "Create, update, patch, list, read, or remove panels in the user's workspace " +
        "(the reshapeable 'shell'). Panels are JSON specs persisted across sessions; " +
        "the user can drag, resize, and remove them. 'create' adds a new panel, " +
        "'update' replaces an existing one (same id) in full, 'patch' applies RFC 6902 " +
        "operations for targeted edits (cheap for large specs), 'list' shows what exists. " +
        "The chat panel is permanent and can't be removed.",
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
              const { widgets } = mgr.list();
              return text(
                widgets
                  .map((w) =>
                    isArtifactWidget(w)
                      ? `- ${w.id}: "${w.title}"${w.description ? ` — ${w.description}` : ""} (${Object.keys(w.spec.elements).length} elements)`
                      : `- ${w.id}: [${w.type}] (permanent)`,
                  )
                  .join("\n"),
              );
            }
            case "read": {
              if (!params.id) return text("Error: id is required for action='read'");
              const found = mgr.getWidget(params.id);
              if (!found) return text(`Error: no widget with id '${params.id}'`);
              return text(JSON.stringify(found, null, 2));
            }
            case "create": {
              if (!params.title) return text("Error: title is required for action='create'");
              if (!params.spec) return text("Error: spec is required for action='create'");
              // create is distinct from update — fail if the caller-supplied
              // id already exists, instead of silently overwriting.
              if (params.id !== undefined && mgr.getWidget(params.id)) {
                return text(
                  `Error: widget '${params.id}' already exists. Use action='update' to modify it, or omit id to auto-generate one.`,
                );
              }
              const created = mgr.upsertArtifact({
                id: params.id,
                title: params.title,
                description: params.description,
                spec: params.spec,
                state: params.state,
              });
              return text(`Created panel '${created.id}' ("${created.title}").`);
            }
            case "update": {
              if (!params.id) return text("Error: id is required for action='update'");
              const existing = mgr.getWidget(params.id);
              if (!existing || !isArtifactWidget(existing)) {
                return text(`Error: no editable panel with id '${params.id}'`);
              }
              // title and spec are overwritten unconditionally by upsert, so
              // resolve them here; description and state fall through to
              // upsert's own omitted-preserves-existing fallback.
              const updated = mgr.upsertArtifact({
                id: params.id,
                title: params.title ?? existing.title,
                description: params.description,
                spec: params.spec ?? existing.spec,
                state: params.state,
              });
              return text(`Updated panel '${updated.id}'.`);
            }
            case "patch": {
              if (!params.id) return text("Error: id is required for action='patch'");
              if (!params.ops || params.ops.length === 0) {
                return text("Error: ops is required for action='patch' (at least one operation)");
              }
              const patched = mgr.patchArtifactSpec({ id: params.id, ops: params.ops });
              return text(
                `Patched panel '${patched.id}' (${params.ops.length} op${params.ops.length === 1 ? "" : "s"}).`,
              );
            }
            case "remove": {
              if (!params.id) return text("Error: id is required for action='remove'");
              const target = mgr.getWidget(params.id);
              if (!target) return text(`No widget with id '${params.id}' to remove.`);
              const removed = mgr.removeWidget(params.id);
              return text(
                removed
                  ? `Removed panel '${params.id}'.`
                  : `Cannot remove '${params.id}' — it's a permanent panel.`,
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
