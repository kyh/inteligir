/**
 * UI settings extension — exposes the `modify_ui_settings` tool so the agent
 * can read and rewrite the JSON spec that drives the Settings panel.
 *
 * The spec is a json-render flat tree validated against the catalog defined
 * in `apps/desktop/src/renderer/chat/settings-catalog.ts`. We keep the
 * validation here loose (structure-only) and let the renderer's catalog
 * surface prop-shape errors at mount — the tool's purpose is to make the
 * persisted spec writable from the model, not to re-implement json-render's
 * type checking.
 */

import { Type, type Static } from "@sinclair/typebox";

import { getUiSettings } from "@/main/ui-settings";
import { toErrorMessage } from "@/shared/ipc";
import type { UiSpec } from "@/shared/ui-settings";
import type { PiExtensionBundle } from "@/agent/extension";

const SpecSchema = Type.Object({
  root: Type.String({ description: "Key of the root element in the elements map" }),
  elements: Type.Record(
    Type.String(),
    Type.Object(
      {
        type: Type.String({
          description: "Component type, e.g. Stack, Section, Row, Button, Checkbox, Text",
        }),
        props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        children: Type.Optional(
          Type.Array(Type.String(), {
            description: "Child element keys (referencing other entries in this map)",
          }),
        ),
        visible: Type.Optional(Type.Unknown()),
        on: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        watch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      },
      { additionalProperties: false },
    ),
    {
      description:
        "Flat map of element key -> element. The 'root' field above must reference a key in this map.",
    },
  ),
  state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const ModifyUiSettingsSchema = Type.Object({
  action: Type.Union(
    [Type.Literal("read"), Type.Literal("write"), Type.Literal("reset")],
    { description: "Action to perform" },
  ),
  spec: Type.Optional(
    Type.Unsafe<UiSpec>({
      ...SpecSchema,
      description:
        "json-render flat spec ({ root, elements }) — required for action='write'. " +
        "Replaces the entire settings panel spec on disk and immediately re-renders the UI. " +
        "Catalog: components { Stack, Section, Row, Heading, Text, TextBlock, Button, Checkbox, Card }; " +
        "actions { logout, newSession, setNotifications, resetUiSettings }. " +
        "Wire buttons with on: { press: { action: '<name>' } }. " +
        "Bind checkboxes with checked: { $bindState: '/path' } and add a watch to call an action when the path changes. " +
        "Read app facts via { $state: '/app/connected' | '/app/canStartSession' | '/notifications/enabled' }.",
    }),
  ),
});

const uiSettingsExtension: PiExtensionBundle = {
  name: "modify_ui_settings",
  register: () => (pi) => {
    pi.registerTool({
      name: "modify_ui_settings",
      label: "modify_ui_settings",
      description:
        "Read, replace, or reset the JSON spec that drives the Settings panel. " +
        "The renderer validates the spec at mount; a malformed spec surfaces as " +
        "render errors but does not crash the app. Use action='read' to see the " +
        "current spec before editing, 'write' to replace it, 'reset' to restore defaults.",
      parameters: ModifyUiSettingsSchema,
      execute: async (_toolCallId, params: Static<typeof ModifyUiSettingsSchema>) => {
        const text = (s: string) => ({
          content: [{ type: "text" as const, text: s }],
          details: {},
        });
        try {
          switch (params.action) {
            case "read": {
              const cfg = getUiSettings().get();
              return text(JSON.stringify(cfg.spec, null, 2));
            }
            case "write": {
              if (!params.spec) return text("Error: spec is required for action='write'");
              const next = getUiSettings().setSpec(params.spec);
              return text(
                `Updated settings spec (${Object.keys(next.spec.elements).length} elements). UI re-rendered.`,
              );
            }
            case "reset": {
              getUiSettings().reset();
              return text("Settings spec reset to defaults.");
            }
          }
        } catch (err) {
          return text(`Error: ${toErrorMessage(err)}`);
        }
      },
    });
  },
};

export default uiSettingsExtension;
