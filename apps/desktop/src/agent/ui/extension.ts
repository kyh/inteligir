import { deleteWithFlush, placeWithFlush, unplaceWithFlush } from "@/main/lib/shell-actions";
import { getWritableShell } from "@/main/shell";
import { toErrorMessage } from "@/shared/ipc";
import { describeWidgetSpecLanguage } from "@/shared/widget-spec";
import { isBuiltin, isJsonUi } from "@/shared/shell";
import { ManageUiSchema, type ManageUiParams } from "@/agent/ui/schema";
import type { PiExtensionBundle } from "@/agent/extension";

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
        "an instance on the shell. Use action='catalog' to inspect generated widget components " +
        "and actions. Generated widgets are trusted and can use live actions.",
      parameters: ManageUiSchema,
      execute: async (_toolCallId, params: ManageUiParams) => {
        // Short-circuit while writes are suspended (post-logout) BEFORE
        // calling getShell — the constructor's withPermanentInstances repair
        // and any mutation below would otherwise re-create ~/.inteligir from
        // an in-flight tool call.
        const mgr = getWritableShell();
        if (!mgr) {
          return text("Error: shell is unavailable (signed out).");
        }
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
            case "catalog": {
              return text(describeWidgetSpecLanguage());
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
              const instance = await placeWithFlush(params.id, params.surface);
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
