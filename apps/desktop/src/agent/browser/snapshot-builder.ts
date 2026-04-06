/**
 * Accessibility snapshot builder.
 *
 * Runs an in-page IIFE via Runtime.evaluate to walk the DOM and produce a
 * text-based accessibility tree with @eN refs for interactive elements.
 */

import { type CDPClient, evaluate } from "./cdp-client";
import type { BrowserSession } from "./browser-session";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 30_000;
const DEFAULT_MAX_DEPTH = 40;
const DEFAULT_MAX_NODES = 10_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SnapshotOptions {
  maxChars?: number;
  maxDepth?: number;
  maxNodes?: number;
}

export async function buildSnapshot(
  cdp: CDPClient,
  session: BrowserSession,
  opts?: SnapshotOptions,
): Promise<string> {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;

  const result = await evaluate(cdp, `
    (function() {
      const interactiveRoles = new Set([
        "link", "button", "textbox", "checkbox", "radio", "combobox",
        "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton",
      ]);

      const roleMap = { a: "link", button: "button", input: "textbox",
        textarea: "textbox", select: "combobox" };

      const MAX_DEPTH = ${maxDepth};
      const MAX_NODES = ${maxNodes};
      let refCounter = 0;
      let nodeCount = 0;
      const refs = [];

      function getRole(el) {
        return el.getAttribute("role") || roleMap[el.tagName.toLowerCase()] || null;
      }

      function walk(el, depth) {
        if (!el || el.nodeType !== 1) return "";
        if (depth > MAX_DEPTH || nodeCount >= MAX_NODES) return "";
        nodeCount++;
        const role = getRole(el) || el.tagName.toLowerCase();
        const name = el.getAttribute("aria-label") || el.getAttribute("alt")
          || el.getAttribute("title") || el.getAttribute("placeholder") || "";
        const value = el.value !== undefined && el.value !== "" ? el.value : "";

        let refLabel = "";
        const isInteractive = interactiveRoles.has(role) ||
          (el.tagName === "A" && el.href) ||
          el.tagName === "BUTTON" ||
          (el.tagName === "INPUT" && el.type !== "hidden") ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT";

        if (isInteractive) {
          refCounter++;
          refLabel = " @e" + refCounter;

          let selector;
          if (el.id) {
            selector = "#" + CSS.escape(el.id);
          } else if (el.getAttribute("aria-label")) {
            const r = el.getAttribute("role") || el.tagName.toLowerCase();
            const candidate = r + '[aria-label="' + CSS.escape(el.getAttribute("aria-label")) + '"]';
            if (document.querySelectorAll(candidate).length === 1) {
              selector = candidate;
            }
          }
          if (!selector) {
            const parts = [];
            let cur = el;
            while (cur && cur !== document.body) {
              const parent = cur.parentElement;
              if (!parent) break;
              const tag = cur.tagName;
              const siblings = Array.from(parent.children).filter(c => c.tagName === tag);
              const idx = siblings.indexOf(cur) + 1;
              const t = tag.toLowerCase();
              parts.unshift(siblings.length > 1 ? t + ":nth-of-type(" + idx + ")" : t);
              cur = parent;
            }
            selector = parts.join(" > ");
          }
          refs.push({ ref: "@e" + refCounter, selector: selector });
        }

        const indent = "  ".repeat(depth);
        let line = indent + "[" + role + "]" + refLabel;
        const label = name || (el.textContent || "").trim().slice(0, 60);
        if (label) line += " " + JSON.stringify(label);
        if (value) line += " value=" + JSON.stringify(value);

        const lines = [line];
        for (const child of el.children) {
          const childResult = walk(child, depth + 1);
          if (childResult) lines.push(childResult);
        }
        return lines.join("\\n");
      }

      const tree = walk(document.body, 0);
      return JSON.stringify({ tree: tree, refs: refs });
    })()
  `);

  const parsed = JSON.parse(result as string) as {
    tree: string;
    refs: { ref: string; selector: string }[];
  };

  session.updateRefs(parsed.refs);

  const tree = parsed.tree;
  if (tree.length > maxChars) {
    const truncated = tree.slice(0, maxChars);
    return `${truncated}\n\n(truncated — showing first ${maxChars} chars; refs from the visible portion are usable)`;
  }
  return tree;
}
