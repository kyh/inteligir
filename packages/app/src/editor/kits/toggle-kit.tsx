// Toggle kit — Base half (WP1). Node shape: { type: "toggle", children } — the
// collapsed/open state lives in the plugin's store (openIds), never on the
// node, so a collapse/expand can't dirty the document (md rule fixture asserts
// `<toggle>` serializes with zero attributes).
// WP2 appends: ToggleKit = [TogglePlugin.withComponent(ToggleElement)] and
// insertToggle(editor).

import { BaseTogglePlugin } from "@platejs/toggle";

export const ToggleBaseKit = [BaseTogglePlugin];
