/**
 * Browser tool schema, action type, and result helpers.
 *
 * Shared by the slim entry point (`browser-tool.ts`) and the action dispatcher.
 * Lives here to avoid circular imports.
 */

import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const BrowserActionSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("open"),
      Type.Literal("click"),
      Type.Literal("fill"),
      Type.Literal("type"),
      Type.Literal("press"),
      Type.Literal("hover"),
      Type.Literal("select"),
      Type.Literal("snapshot"),
      Type.Literal("screenshot"),
      Type.Literal("get_text"),
      Type.Literal("get_url"),
      Type.Literal("get_title"),
      Type.Literal("evaluate"),
      Type.Literal("wait"),
      Type.Literal("check"),
      Type.Literal("scroll"),
      Type.Literal("back"),
      Type.Literal("forward"),
      Type.Literal("reload"),
      Type.Literal("close"),
    ],
    { description: "Browser action to perform" },
  ),
  url: Type.Optional(Type.String({ description: "URL (for open action)" })),
  selector: Type.Optional(
    Type.String({
      description:
        "CSS selector or @ref from snapshot (e.g. @e1). Used for click, fill, type, hover, select, get_text, wait.",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description: "Text value (for fill, type actions) or key name (for press)",
    }),
  ),
  script: Type.Optional(
    Type.String({ description: "JavaScript to evaluate (for evaluate action)" }),
  ),
  direction: Type.Optional(
    Type.Union([Type.Literal("up"), Type.Literal("down")], {
      description: "Scroll direction (default: down)",
    }),
  ),
  amount: Type.Optional(
    Type.Number({ description: "Scroll amount in pixels (default: 500)" }),
  ),
  fullPage: Type.Optional(
    Type.Boolean({ description: "Full page screenshot (default: false)" }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in ms for wait action (default: 5000)" }),
  ),
  checked: Type.Optional(
    Type.Boolean({ description: "Desired checked state for check action (default: true)" }),
  ),
});

export type BrowserAction = Static<typeof BrowserActionSchema>;

// ---------------------------------------------------------------------------
// Result helpers — must match pi-ai's TextContent / ImageContent interfaces
// ---------------------------------------------------------------------------

export type ToolResult = {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  details: Record<string, unknown>;
};

export function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }], details: {} };
}
