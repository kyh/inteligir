// An embed renders through PlateStatic, whose default element is a <div> or the plugin's own
// tag: a void drawn that way shows nothing of its node, and a void tag like <hr> throws on the
// spacer child every void carries.

import { describe, expect, it } from "vitest";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { STATIC_COMPONENTS } from "@repo/editor/transclusion";

const pluginKeys = new Set(BASE_KIT.map((plugin) => String(plugin.key)));

describe("the transclusion kit's static renderers", () => {
  it("draws every void BASE_KIT carries", () => {
    const missing = BASE_KIT.filter((plugin) => plugin.node.isVoid === true)
      .map((plugin) => String(plugin.key))
      .filter((key) => !STATIC_COMPONENTS.has(key));
    expect(
      missing,
      `void plugin(s) ${missing.join(", ")} have no row in STATIC_COMPONENTS ` +
        "(packages/editor/src/transclusion.tsx); an embed would draw them empty",
    ).toEqual([]);
  });

  it("keys every row on a plugin BASE_KIT still carries", () => {
    const stale = [...STATIC_COMPONENTS.keys()].filter((key) => !pluginKeys.has(key));
    expect(
      stale,
      `STATIC_COMPONENTS row(s) ${stale.join(", ")} name no BASE_KIT plugin, so they never render`,
    ).toEqual([]);
  });
});
