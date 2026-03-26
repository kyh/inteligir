/**
 * CDP helpers for input simulation.
 *
 * Pure functions taking WebContents as first param — easy to test with a stub.
 */

import type { WebContents } from "electron";

// ---------------------------------------------------------------------------
// Key map for cdpPress
// ---------------------------------------------------------------------------

const keyMap: Record<string, { key: string; code: string; keyCode?: number }> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Space: { key: " ", code: "Space", keyCode: 32 },
};

// ---------------------------------------------------------------------------
// Element center — shared by click and hover
// ---------------------------------------------------------------------------

/**
 * Get the bounding box of an element via executeJavaScript.
 * Returns center coordinates for click/hover targets.
 */
export async function getElementCenter(
  contents: WebContents,
  selector: string,
): Promise<{ x: number; y: number }> {
  const rect = await contents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()
  `);
  if (!rect) throw new Error(`Element not found: ${selector}`);
  return rect as { x: number; y: number };
}

// ---------------------------------------------------------------------------
// CDP input commands
// ---------------------------------------------------------------------------

export async function cdpClick(contents: WebContents, selector: string): Promise<void> {
  const { x, y } = await getElementCenter(contents, selector);
  const debugger_ = contents.debugger;
  for (const type of ["mousePressed", "mouseReleased"] as const) {
    await debugger_.sendCommand("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }
}

export async function cdpType(contents: WebContents, value: string): Promise<void> {
  // Input.insertText sends the entire string in a single CDP round-trip,
  // which is dramatically faster than dispatching keyDown/keyUp per character.
  await contents.debugger.sendCommand("Input.insertText", { text: value });
}

export async function cdpPress(contents: WebContents, key: string): Promise<void> {
  const mapped = keyMap[key] ?? { key, code: `Key${key.toUpperCase()}` };
  const debugger_ = contents.debugger;

  await debugger_.sendCommand("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.keyCode,
  });
  await debugger_.sendCommand("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.keyCode,
  });
}

export async function cdpHover(contents: WebContents, selector: string): Promise<void> {
  const { x, y } = await getElementCenter(contents, selector);
  await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
}
