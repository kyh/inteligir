import { describe, expect, it } from "vitest";

import { widgetCatalog } from "@/renderer/shell/widget-catalog";
import {
  componentDescription,
  componentPropsSignature,
  describeWidgetSpecLanguage,
  parseWidgetSpec,
  validateWidgetProps,
} from "@/shared/widget-spec";

const VALID_SPEC = {
  root: "card",
  elements: {
    // No props/children/visible — canonicalization must fill them.
    card: { type: "Card", children: ["text", "badge"] },
    // Dynamic-value objects must pass where the schema documents a string.
    text: { type: "Text", props: { text: { $bindState: "/msg" }, muted: true } },
    badge: { type: "Badge", props: { text: "ok", variant: "secondary" } },
  },
  state: { msg: "hi" },
};

describe("parseWidgetSpec — accepts", () => {
  it("parses a valid spec and canonicalizes missing element fields", () => {
    const spec = parseWidgetSpec(VALID_SPEC);
    expect(spec.root).toBe("card");
    expect(spec.elements["card"]?.props).toEqual({});
    expect(spec.elements["card"]?.visible).toBe(true);
    expect(spec.elements["text"]?.children).toEqual([]);
  });

  it("accepts dynamic-value objects in bindable props", () => {
    const spec = parseWidgetSpec({
      root: "list",
      elements: {
        list: {
          type: "Stack",
          props: { gap: "sm" },
          repeat: { statePath: "/items", key: "id" },
          children: ["item"],
        },
        item: {
          type: "Checkbox",
          props: { label: { $item: "title" }, checked: { $bindItem: "done" } },
        },
      },
      state: { items: [] },
    });
    expect(spec.elements["item"]?.type).toBe("Checkbox");
  });
});

describe("parseWidgetSpec — rejects bad structure", () => {
  it("rejects a non-object input", () => {
    expect(() => parseWidgetSpec("nope")).toThrow(/Invalid widget spec/);
  });

  it("rejects a root that doesn't exist", () => {
    expect(() => parseWidgetSpec({ root: "ghost", elements: {} })).toThrow(
      /root 'ghost' does not exist/,
    );
  });

  it("rejects a reference to a missing child", () => {
    expect(() =>
      parseWidgetSpec({
        root: "r",
        elements: { r: { type: "Card", children: ["gone"] } },
      }),
    ).toThrow(/missing child 'gone'/);
  });

  it("rejects a child cycle", () => {
    expect(() =>
      parseWidgetSpec({
        root: "a",
        elements: {
          a: { type: "Card", children: ["b"] },
          b: { type: "Card", children: ["a"] },
        },
      }),
    ).toThrow(/child cycle/);
  });

  it("rejects an unknown component type", () => {
    expect(() =>
      parseWidgetSpec({ root: "r", elements: { r: { type: "Sparkles", props: {} } } }),
    ).toThrow(/Invalid widget spec/);
  });
});

describe("parseWidgetSpec — rejects bad component props at the write boundary", () => {
  it("rejects an unknown prop, naming the element, component, and path", () => {
    // The classic failure mode: text passed via props.children on a Card.
    expect(() =>
      parseWidgetSpec({
        root: "r",
        elements: { r: { type: "Card", props: { children: "hello" } } },
      }),
    ).toThrow(/element 'r' \(Card\) props\.children: Unexpected property/);
  });

  it("rejects a wrong prop type with a dynamic-aware message", () => {
    expect(() =>
      parseWidgetSpec({
        root: "r",
        elements: { r: { type: "Text", props: { text: 42 } } },
      }),
    ).toThrow(/element 'r' \(Text\) props\.text: Expected string or a dynamic-value object/);
  });

  it("rejects a missing required prop and includes the expected contract", () => {
    let message = "";
    try {
      parseWidgetSpec({ root: "r", elements: { r: { type: "Heading", props: {} } } });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/element 'r' \(Heading\) props\.text: Expected required property/);
    expect(message).toContain("Heading: { text: string, level?: '1'|'2'|'3' }");
  });

  it("rejects a bad enum value by listing the allowed literals", () => {
    expect(() =>
      parseWidgetSpec({
        root: "r",
        elements: { r: { type: "Badge", props: { text: "x", variant: "zazzy" } } },
      }),
    ).toThrow(/Expected one of 'default' \| 'secondary' \| 'destructive' \| 'outline' \| 'ghost'/);
  });

  it("rejects unknown Chart props (the catalog's old non-strict drift)", () => {
    expect(() =>
      parseWidgetSpec({
        root: "r",
        elements: {
          r: { type: "Chart", props: { series: [{ key: "v" }], wat: 1 } },
        },
      }),
    ).toThrow(/element 'r' \(Chart\) props\.wat: Unexpected property/);
  });

  it("skips prop validation only when asked (store decode path), keeping structure strict", () => {
    const legacy = {
      root: "r",
      elements: { r: { type: "Card", props: { className: "legacy" } } },
    };
    expect(() => parseWidgetSpec(legacy)).toThrow(/Unexpected property/);
    const spec = parseWidgetSpec(legacy, { skipComponentProps: true });
    expect(spec.elements["r"]?.props).toEqual({ className: "legacy" });
    // Structural problems still throw even when props are skipped.
    expect(() =>
      parseWidgetSpec({ root: "ghost", elements: {} }, { skipComponentProps: true }),
    ).toThrow(/root 'ghost' does not exist/);
  });
});

describe("validateWidgetProps — renderer defense-in-depth walker", () => {
  it("returns success for valid elements", () => {
    const result = validateWidgetProps({
      elements: { r: { type: "Text", props: { text: "hi" } } },
    });
    expect(result.success).toBe(true);
  });

  it("flags an unknown component type instead of silently skipping it", () => {
    const result = validateWidgetProps({ elements: { r: { type: "Sparkles", props: {} } } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]).toMatchObject({
        elementKey: "r",
        component: "Sparkles",
        message: "Unknown component type 'Sparkles'",
      });
    }
  });

  it("reports one issue per offending prop path", () => {
    const result = validateWidgetProps({
      elements: { r: { type: "Heading", props: { level: "9", bogus: true } } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.issues.map((i) => i.path).toSorted();
      expect(paths).toEqual(["bogus", "level", "text"]);
    }
  });
});

describe("derived prose", () => {
  it("derives the Props: signature from the schema", () => {
    expect(componentPropsSignature("Stack")).toBe("{ gap?: 'sm'|'md'|'lg' }");
    expect(componentPropsSignature("Card")).toBe("{}");
    expect(componentPropsSignature("Select")).toBe(
      "{ label?: string, placeholder?: string, value?: string, options: { label: string, value: string }[], disabled?: boolean }",
    );
  });

  it("composes descriptions as summary + derived signature + note", () => {
    expect(componentDescription("Stack")).toBe(
      "Vertical stack container. Props: { gap?: 'sm'|'md'|'lg' }. Use as the top-level wrapper or nested groups.",
    );
  });

  it("describes every component with its derived contract in the agent prompt", () => {
    const prompt = describeWidgetSpecLanguage();
    expect(prompt).toContain("- Stack: Vertical stack container. Props: { gap?: 'sm'|'md'|'lg' }");
    expect(prompt).toContain("- Separator: Horizontal hairline divider. Props: {}.");
    // Dynamic-capable props read as their resolved primitive.
    expect(prompt).toContain(
      "- Heading: Heading text. Props: { text: string, level?: '1'|'2'|'3' }.",
    );
  });
});

describe("renderer catalog adapter", () => {
  it("delegates the catalog's zod prop validation to the shared TypeBox schemas", () => {
    const badge = widgetCatalog.data.components.Badge;
    expect(badge.props.safeParse({ text: "x", variant: "secondary" }).success).toBe(true);
    expect(badge.props.safeParse({ text: { $bindState: "/t" } }).success).toBe(true);
    expect(badge.props.safeParse({ text: "x", variant: "zazzy" }).success).toBe(false);
    expect(badge.props.safeParse({ text: "x", className: "nope" }).success).toBe(false);
    // Description is the derived shared prose, not a hand-written copy.
    expect(badge.description).toBe(componentDescription("Badge"));
  });
});
