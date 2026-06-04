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

/** Validate that the optional fields the LLM should have supplied for this
 * action are actually present. Returns a tool-error text on miss so the
 * agent can self-correct rather than crashing the turn. */
function require<T>(value: T | undefined, name: string, action: string): T | ToolTextResult {
  if (value === undefined || value === null || value === "") {
    return text(`Error: '${name}' is required for action '${action}'.`);
  }
  return value;
}
function isErr(v: unknown): v is ToolTextResult {
  return typeof v === "object" && v !== null && "content" in v;
}

const uiExtension: PiExtensionBundle = {
  name: "manage_ui",
  register: () => (pi) => {
    pi.registerTool({
      name: "manage_ui",
      label: "manage_ui",
      description:
        "Manage the user's runtime UI. Built-in widgets are system React widgets; generated " +
        "widgets are json-ui specs. action='install' creates a def AND pins a pinned instance " +
        "in one call — for a typical 'make me a widget' request, that's all you need. " +
        "action='place' creates an additional instance of an already-installed def. " +
        "Use action='catalog' to inspect generated widget components and actions. " +
        "Generated widgets are trusted and can use live actions.",
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
              const id = require(params.id, "id", "read");
              if (isErr(id)) return id;
              const def = mgr.getDef(id);
              return def ? text(JSON.stringify(def, null, 2)) : text(`Error: no widget '${id}'`);
            }
            case "install": {
              const title = require(params.title, "title", "install");
              if (isErr(title)) return title;
              const spec = require(params.spec, "spec", "install");
              if (isErr(spec)) return spec;
              const def = mgr.installWidget({
                id: params.id,
                title,
                description: params.description,
                spec,
              });
              // Place immediately so a single tool call gives the user a
              // visible widget. The agent can unplace later if they wanted a
              // catalog-only install (rare). Place failures fall through to
                // the install-only success message so the catalog still works.
              try {
                const instance = await placeWithFlush(def.id, "pinned");
                if (instance) {
                  return text(
                    `Installed '${def.id}' rev ${def.revision} and placed as ${instance.placement.surface} instance ${instance.instanceId}.`,
                  );
                }
              } catch (err) {
                console.warn("[manage_ui] post-install place failed:", err);
              }
              return text(
                `Installed generated widget '${def.id}' rev ${def.revision}. (Auto-place skipped — use action='place' to open it.)`,
              );
            }
            case "update": {
              const id = require(params.id, "id", "update");
              if (isErr(id)) return id;
              const expectedRevision = require(params.expectedRevision, "expectedRevision", "update");
              if (isErr(expectedRevision)) return expectedRevision;
              const spec = require(params.spec, "spec", "update");
              if (isErr(spec)) return spec;
              const def = mgr.updateWidget({
                id,
                expectedRevision,
                title: params.title,
                description: params.description,
                spec,
              });
              return text(`Updated generated widget '${def.id}' to rev ${def.revision}.`);
            }
            case "patch": {
              const id = require(params.id, "id", "patch");
              if (isErr(id)) return id;
              const expectedRevision = require(params.expectedRevision, "expectedRevision", "patch");
              if (isErr(expectedRevision)) return expectedRevision;
              const ops = require(params.ops, "ops", "patch");
              if (isErr(ops)) return ops;
              const def = mgr.patchWidgetSpec({ id, expectedRevision, ops });
              return text(`Patched generated widget '${def.id}' to rev ${def.revision}.`);
            }
            case "delete": {
              const id = require(params.id, "id", "delete");
              if (isErr(id)) return id;
              const deleted = await deleteWithFlush(id, params.expectedRevision);
              return text(
                deleted ? `Deleted generated widget '${id}'.` : `No generated widget '${id}'.`,
              );
            }
            case "place": {
              const id = require(params.id, "id", "place");
              if (isErr(id)) return id;
              const instance = await placeWithFlush(id, params.surface);
              return instance
                ? text(
                    `Placed '${id}' as ${instance.placement.surface} instance ${instance.instanceId}.`,
                  )
                : text(`Error: no widget '${id}'`);
            }
            case "unplace": {
              const instanceId = require(params.instanceId, "instanceId", "unplace");
              if (isErr(instanceId)) return instanceId;
              const removed = await unplaceWithFlush(instanceId);
              return text(
                removed ? `Unplaced '${instanceId}'.` : `Cannot unplace '${instanceId}'.`,
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
