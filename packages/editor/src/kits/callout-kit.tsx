// Callout compatibility kit. `<callout>` is in the locked vocabulary (the
// agent or an imported note may contain it; Plate's defaultRules.callout
// round-trips it), but the PRODUCT never creates one — our slash "Callout"
// stays the GitHub-alert blockquote. The React half renders these nodes in
// the alert visual family so they don't fall to Slate's DefaultElement.

import { createSlatePlugin } from "platejs";

import { CalloutElement } from "@repo/editor/nodes/callout-node";

const CalloutBasePlugin = createSlatePlugin({ key: "callout", node: { isElement: true } });

export const CalloutBaseKit = [CalloutBasePlugin];

export const CalloutKit = [CalloutBasePlugin.withComponent(CalloutElement)];
