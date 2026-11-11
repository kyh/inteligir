import { createSlatePlugin } from "platejs";

import { TAB_GROUP_KEY, TAB_PANEL_KEY } from "@repo/editor/dialect-node-keys";

export const tabGroupBasePlugin = createSlatePlugin({
  key: TAB_GROUP_KEY,
  node: { isElement: true },
});

export const tabPanelBasePlugin = createSlatePlugin({
  key: TAB_PANEL_KEY,
  node: { isElement: true },
});

export const TabsBaseKit = [tabGroupBasePlugin, tabPanelBasePlugin];
