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
      Type.Literal("open", { description: "Navigate the current tab to a URL (http/https only). Use tab_new instead to open a separate tab." }),
      Type.Literal("click", { description: "Click an element. selector: @eN from a snapshot, or a CSS selector." }),
      Type.Literal("fill", { description: "Clear an input/textarea then type. Required: selector, text." }),
      Type.Literal("type", { description: "Type text into the focused element. If selector is given, click it first. Required: text." }),
      Type.Literal("press", { description: "Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown). Required: text (the key name)." }),
      Type.Literal("hover", { description: "Move the mouse over an element. Required: selector." }),
      Type.Literal("select", { description: "Pick a <select>'s <option> by its value attribute (not visible label). Required: selector, text." }),
      Type.Literal("check", { description: "Toggle a checkbox. Required: selector. Optional: checked (default true)." }),
      Type.Literal("snapshot", { description: "Return the page's accessibility tree with @eN refs for interactive elements. Always run after navigation or DOM change." }),
      Type.Literal("screenshot", { description: "PNG screenshot. Optional: fullPage (default false). Full-page is capped at 1280x16384." }),
      Type.Literal("get_text", { description: "Return text content. With selector, returns that element's textContent; otherwise document.body.innerText." }),
      Type.Literal("get_url", { description: "Return the current page URL." }),
      Type.Literal("get_title", { description: "Return the current document title." }),
      Type.Literal("evaluate", { description: "Run JS in the page (returnByValue, awaitPromise). Required: script. Optional: timeout (default 30000ms)." }),
      Type.Literal("wait", { description: "Wait for selector to appear, or for a fixed timeout (ms, default 5000)." }),
      Type.Literal("scroll", { description: "Scroll the page. Optional: direction (up/down, default down), amount (px, default 500)." }),
      Type.Literal("back", { description: "Go back in history." }),
      Type.Literal("forward", { description: "Go forward in history." }),
      Type.Literal("reload", { description: "Reload the current page." }),
      Type.Literal("close", { description: "Close the entire browser session and dispose all tabs." }),
      Type.Literal("cookies_get", { description: "List all cookies for the current browser session." }),
      Type.Literal("cookies_set", { description: "Set a cookie on the current page's URL. Required: name, value. Optional: domain." }),
      Type.Literal("cookies_clear", { description: "Delete every cookie." }),
      Type.Literal("storage_get", { description: "Read localStorage. With name returns that key; without name returns all keys for the current origin." }),
      Type.Literal("storage_set", { description: "Write a localStorage key for the current origin. Required: name, value." }),
      Type.Literal("storage_clear", { description: "Clear localStorage for the current origin." }),
      Type.Literal("tab_list", { description: "List open tabs (ids t1, t2, ...). The current tab is marked with *." }),
      Type.Literal("tab_new", { description: "Open a new tab and switch to it. Optional: url (also navigates), label." }),
      Type.Literal("tab_switch", { description: "Switch to a tab by id (e.g. t2). Required: tabId. Refs from the previous tab are cleared." }),
      Type.Literal("tab_close", { description: "Close a tab. Defaults to the current tab. Optional: tabId." }),
    ],
    { description: "The browser action to perform. See each variant's description for required fields." },
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
  name: Type.Optional(
    Type.String({ description: "Cookie or storage key name" }),
  ),
  value: Type.Optional(
    Type.String({ description: "Cookie or storage value" }),
  ),
  domain: Type.Optional(
    Type.String({ description: "Cookie domain (defaults to current page host)" }),
  ),
  tabId: Type.Optional(
    Type.String({ description: "Tab id (e.g. t1) for tab_switch / tab_close" }),
  ),
  label: Type.Optional(
    Type.String({ description: "Optional human-readable label for tab_new" }),
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
