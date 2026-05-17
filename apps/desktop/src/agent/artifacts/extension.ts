/**
 * Artifacts extension — exposes the `manage_artifacts` tool so the agent
 * can create, update, list, read, and delete JSON-rendered UI panels.
 *
 * Each artifact is a json-render flat spec stored at
 * ~/.inteligir/artifacts.json and surfaced in the renderer's "Artifacts"
 * library (and as a floating panel when the user opens it). Spec validation
 * is loose here — the renderer's catalog does the strict prop-shape check
 * at mount time, so a malformed spec will still surface render errors
 * gracefully rather than crashing the tool call.
 */

import { Type, type Static } from "@sinclair/typebox";

import { getArtifacts } from "@/main/artifacts";
import { toErrorMessage } from "@/shared/ipc";
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

const ManageArtifactsSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("list"),
      Type.Literal("read"),
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("delete"),
    ],
    { description: "Action to perform" },
  ),
  id: Type.Optional(
    Type.String({
      description:
        "Artifact id (required for read/update/delete; optional for create — generated from title if omitted)",
    }),
  ),
  title: Type.Optional(
    Type.String({
      description:
        "Human-readable title shown in the library and as the floating panel header (required for create)",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "Optional short subtitle shown under the title in the library" }),
  ),
  spec: Type.Optional(
    Type.Unsafe<ArtifactSpec>({
      ...SpecParam,
      description:
        "json-render flat spec ({ root, elements }) — required for create, optional for update. " +
        "Components catalog: Stack/Section/Row/Heading/Text/TextBlock/Button/Checkbox/Input/Card/Separator. " +
        "Wire buttons via on: { press: { action: 'notify', params: { message: 'Hi' } } }. " +
        "Bind inputs/checkboxes via { $bindState: '/path' }; use the built-in setState action to mutate state from buttons. " +
        "Available actions: notify({message,variant}), openUrl({url}).",
    }),
  ),
  state: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Optional initial bound-state values. Omit to preserve existing state on update, or seed {} on create.",
    }),
  ),
});

const artifactsExtension: PiExtensionBundle = {
  name: "manage_artifacts",
  register: () => (pi) => {
    pi.registerTool({
      name: "manage_artifacts",
      label: "manage_artifacts",
      description:
        "Create, update, list, read, or delete agent-rendered UI panels (artifacts). " +
        "Artifacts are JSON specs persisted across sessions; the user can open them as " +
        "floating panels from the Artifacts library. Use 'create' to introduce a new panel, " +
        "'update' to revise an existing one (same id), 'list' to see what already exists.",
      parameters: ManageArtifactsSchema,
      execute: async (_toolCallId, params: Static<typeof ManageArtifactsSchema>) => {
        const text = (s: string) => ({
          content: [{ type: "text" as const, text: s }],
          details: {},
        });
        const mgr = getArtifacts();
        try {
          switch (params.action) {
            case "list": {
              const { artifacts } = mgr.list();
              if (artifacts.length === 0) return text("No artifacts.");
              return text(
                artifacts
                  .map(
                    (a) =>
                      `- ${a.id}: "${a.title}"${a.description ? ` — ${a.description}` : ""} (${Object.keys(a.spec.elements).length} elements)`,
                  )
                  .join("\n"),
              );
            }
            case "read": {
              if (!params.id) return text("Error: id is required for action='read'");
              const found = mgr.get(params.id);
              if (!found) return text(`Error: no artifact with id '${params.id}'`);
              return text(JSON.stringify(found, null, 2));
            }
            case "create": {
              if (!params.title) return text("Error: title is required for action='create'");
              if (!params.spec) return text("Error: spec is required for action='create'");
              // create is distinct from update — fail if the caller-supplied
              // id already exists, instead of silently overwriting.
              if (params.id && mgr.get(params.id)) {
                return text(
                  `Error: artifact '${params.id}' already exists. Use action='update' to modify it, or omit id to auto-generate one.`,
                );
              }
              const created = mgr.upsert({
                id: params.id,
                title: params.title,
                description: params.description,
                spec: params.spec,
                state: params.state,
              });
              return text(`Created artifact '${created.id}' ("${created.title}").`);
            }
            case "update": {
              if (!params.id) return text("Error: id is required for action='update'");
              const existing = mgr.get(params.id);
              if (!existing) return text(`Error: no artifact with id '${params.id}'`);
              const updated = mgr.upsert({
                id: params.id,
                title: params.title ?? existing.title,
                description: params.description ?? existing.description,
                spec: params.spec ?? existing.spec,
                // Mirror the other fields: omitted = preserve, explicit {} = wipe.
                // upsert has its own ?? fallback but pre-resolving here keeps the
                // four-field treatment consistent and easier to reason about.
                state: params.state ?? existing.state,
              });
              return text(`Updated artifact '${updated.id}'.`);
            }
            case "delete": {
              if (!params.id) return text("Error: id is required for action='delete'");
              const deleted = mgr.delete(params.id);
              return text(
                deleted
                  ? `Deleted artifact '${params.id}'.`
                  : `No artifact with id '${params.id}' to delete.`,
              );
            }
            default:
              // Unreachable under the TypeBox schema, but guards against the
              // tool framework passing through an unexpected action — without
              // this, the function would implicitly return undefined.
              return text(
                `Error: unknown action '${(params as { action: string }).action}'`,
              );
          }
        } catch (err) {
          return text(`Error: ${toErrorMessage(err)}`);
        }
      },
    });
  },
};

export default artifactsExtension;
