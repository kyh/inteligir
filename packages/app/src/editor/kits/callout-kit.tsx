// Callout compatibility kit — Base half (WP1). `<callout>` is in the locked
// vocabulary (the agent or an imported note may contain it; Plate's
// defaultRules.callout round-trips it), but the PRODUCT never creates one —
// our slash "Callout" stays the GitHub-alert blockquote. WP2 appends a
// compat renderer (nodes/callout-node.tsx) so these nodes don't fall to
// Slate's DefaultElement unstyled.

import { createSlatePlugin } from "platejs";

export const CalloutBaseKit = [
  createSlatePlugin({ key: "callout", node: { isElement: true } }),
];
