import { describe, expect, it } from "vitest";

import {
  ACCENT_KEYS,
  CHROME_CONTRAST,
  DEFAULT_APPEARANCE,
  EDITOR_FONT_KEYS,
  FONT_SIZE,
  MONO_FONT_KEYS,
  parseAppearance,
} from "@repo/workspace/appearance/appearance";
import { documentStats } from "@repo/workspace/workspace/document-stats";

describe("parseAppearance", () => {
  it("answers the defaults for anything that is not a record", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("narrow")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(42)).toEqual(DEFAULT_APPEARANCE);
  });

  it("keeps the fields it recognizes and defaults the rest, one field at a time", () => {
    const parsed = parseAppearance({ editorFont: "serif", accent: "nonsense", fontSize: "big" });
    expect(parsed.editorFont).toBe("serif");
    expect(parsed.accent).toBe(DEFAULT_APPEARANCE.accent);
    expect(parsed.fontSize).toBe(DEFAULT_APPEARANCE.fontSize);
  });

  it("clamps numbers into their range rather than dropping them", () => {
    expect(parseAppearance({ fontSize: 999 }).fontSize).toBe(FONT_SIZE.max);
    expect(parseAppearance({ fontSize: 1 }).fontSize).toBe(FONT_SIZE.min);
    expect(parseAppearance({ chromeContrast: -5 }).chromeContrast).toBe(CHROME_CONTRAST.min);
    expect(parseAppearance({ fontSize: Number.NaN }).fontSize).toBe(FONT_SIZE.fallback);
  });

  it("admits only the two editor widths", () => {
    expect(parseAppearance({ editorWidth: "full" }).editorWidth).toBe("full");
    expect(parseAppearance({ editorWidth: "wide" }).editorWidth).toBe("narrow");
  });

  it("round-trips every key the pickers offer", () => {
    for (const editorFont of EDITOR_FONT_KEYS) {
      expect(parseAppearance({ editorFont }).editorFont).toBe(editorFont);
    }
    for (const monoFont of MONO_FONT_KEYS) {
      expect(parseAppearance({ monoFont }).monoFont).toBe(monoFont);
    }
    for (const accent of ACCENT_KEYS) {
      expect(parseAppearance({ accent }).accent).toBe(accent);
    }
  });

  it("does not inherit a key from the prototype chain", () => {
    expect(parseAppearance({ editorFont: "toString" }).editorFont).toBe(
      DEFAULT_APPEARANCE.editorFont,
    );
  });
});

describe("documentStats", () => {
  it("counts nothing in an empty document", () => {
    expect(documentStats("")).toEqual({ words: 0, characters: 0, paragraphs: 0 });
    expect(documentStats("   \n\n  ")).toEqual({ words: 0, characters: 0, paragraphs: 0 });
  });

  it("counts prose, not markup", () => {
    expect(documentStats("# Title\n\n- one\n- two").words).toBe(3);
    expect(documentStats("`code` and [[a wiki link]]").words).toBe(5);
    expect(documentStats("see [the docs](https://example.com)").words).toBe(3);
  });

  it("counts blank-line-separated blocks as paragraphs", () => {
    expect(documentStats("one\n\ntwo\n\n\nthree").paragraphs).toBe(3);
    expect(documentStats("one\ntwo").paragraphs).toBe(1);
  });

  it("collapses whitespace runs when counting characters", () => {
    expect(documentStats("a    b").characters).toBe(3);
  });
});
