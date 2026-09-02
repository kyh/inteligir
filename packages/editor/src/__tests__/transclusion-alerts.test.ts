import { describe, expect, it } from "vitest";
import { ElementApi, KEYS, TextApi, type Value } from "platejs";

import { ALERT_VARIANT_KEY, stripAlertMarkers } from "@repo/editor/transclusion";

function quote(...lines: string[]): Value {
  return [
    {
      type: KEYS.blockquote,
      children: [{ type: KEYS.p, children: [{ text: lines.join("\n") }] }],
    },
  ];
}

function firstText(value: Value): string {
  const block = value[0];
  if (!block) throw new Error("no block");
  const para = block.children[0];
  if (!para || !ElementApi.isElement(para)) throw new Error("no paragraph");
  const leaf = para.children[0];
  return leaf && TextApi.isText(leaf) ? leaf.text : "";
}

describe("stripAlertMarkers", () => {
  it("removes a marker-only first line and records the variant", () => {
    const input = quote("[!TIP]", "Use the palette.");
    const out = stripAlertMarkers(input);

    expect(firstText(out)).toBe("Use the palette.");
    expect(out[0]?.[ALERT_VARIANT_KEY]).toBe("TIP");
    expect(firstText(input)).toBe("[!TIP]\nUse the palette.");
  });

  it("recognizes every alert variant", () => {
    for (const variant of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      const out = stripAlertMarkers(quote(`[!${variant}]`, "body"));
      expect(out[0]?.[ALERT_VARIANT_KEY]).toBe(variant);
      expect(firstText(out)).toBe("body");
    }
  });

  it("leaves the loose form alone — hiding non-marker bytes would lie", () => {
    const input = quote("[!TIP] and some trailing words");
    const out = stripAlertMarkers(input);

    expect(firstText(out)).toBe("[!TIP] and some trailing words");
    expect(out[0]?.[ALERT_VARIANT_KEY]).toBeUndefined();
  });

  it("leaves ordinary blockquotes and non-blockquotes untouched", () => {
    const plain = quote("Just a quotation.");
    expect(stripAlertMarkers(plain)).toEqual(plain);

    const paragraph: Value = [{ type: KEYS.p, children: [{ text: "[!TIP]" }] }];
    expect(stripAlertMarkers(paragraph)).toEqual(paragraph);
  });

  it("ignores an unknown variant", () => {
    const input = quote("[!BOGUS]", "body");
    expect(stripAlertMarkers(input)).toEqual(input);
  });

  it("keeps sibling blocks and later paragraphs of the quote", () => {
    const input: Value = [
      {
        type: KEYS.blockquote,
        children: [
          { type: KEYS.p, children: [{ text: "[!WARNING]" }] },
          { type: KEYS.p, children: [{ text: "second paragraph" }] },
        ],
      },
      { type: KEYS.p, children: [{ text: "after" }] },
    ];
    const out = stripAlertMarkers(input);

    expect(out).toHaveLength(2);
    expect(out[0]?.children).toHaveLength(2);
    expect(firstText(out)).toBe("");
    expect(out[1]).toEqual({ type: KEYS.p, children: [{ text: "after" }] });
  });
});
