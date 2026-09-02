// Compatibility only: Plate's defaultRules round-trip `<callout>`, but the product never
// creates one — slash "Callout" is the GitHub-alert blockquote.

import { createSlatePlugin } from "platejs";

import { CalloutElement } from "@repo/editor/nodes/callout-node";

const CalloutBasePlugin = createSlatePlugin({ key: "callout", node: { isElement: true } });

export const CalloutBaseKit = [CalloutBasePlugin];

export const CalloutKit = [CalloutBasePlugin.withComponent(CalloutElement)];
