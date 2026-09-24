import { describe, expect, it } from "vitest";
import { APPEARANCE_DEFAULTS, EDITOR_FONTS, appearanceTokens } from "../appearance-options";

describe("the appearance dials", () => {
  it("leave every token to the stylesheet at their defaults", () => {
    const tokens = appearanceTokens(APPEARANCE_DEFAULTS);
    expect(tokens.map((entry) => entry.token).toSorted()).toEqual([
      "--editor-font",
      "--editor-line-height",
      "--editor-size",
      "--editor-width",
    ]);
    expect(tokens.filter((entry) => entry.css !== null)).toEqual([]);
  });

  it("set a chosen option's css on its own dial's token alone", () => {
    const serif = EDITOR_FONTS.find((option) => option.value === "serif");
    expect(appearanceTokens({ ...APPEARANCE_DEFAULTS, font: "serif" })).toContainEqual({
      css: serif?.css,
      token: "--editor-font",
    });
    expect(
      appearanceTokens({ ...APPEARANCE_DEFAULTS, font: "serif" }).filter(
        (entry) => entry.css !== null,
      ),
    ).toHaveLength(1);
  });
});
