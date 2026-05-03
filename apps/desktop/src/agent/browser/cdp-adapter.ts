/**
 * CDP helpers for input simulation.
 *
 * Pure functions taking CDPClient as first param — easy to test with a stub.
 */

import { type CDPClient, evaluate } from "./cdp-client";

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

export async function getElementCenter(
  cdp: CDPClient,
  selector: string,
): Promise<{ x: number; y: number }> {
  const rect = await evaluate(
    cdp,
    `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()
  `,
  );
  if (!rect) throw new Error(`Element not found: ${selector}`);
  return rect as { x: number; y: number };
}

// ---------------------------------------------------------------------------
// CDP input commands
// ---------------------------------------------------------------------------

export async function cdpClick(cdp: CDPClient, selector: string): Promise<void> {
  const { x, y } = await getElementCenter(cdp, selector);
  for (const type of ["mousePressed", "mouseReleased"] as const) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }
}

export async function cdpType(cdp: CDPClient, value: string): Promise<void> {
  await cdp.send("Input.insertText", { text: value });
}

export async function cdpPress(cdp: CDPClient, key: string): Promise<void> {
  const mapped = keyMap[key] ?? { key, code: `Key${key.toUpperCase()}` };

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.keyCode,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.keyCode,
  });
}

export async function cdpHover(cdp: CDPClient, selector: string): Promise<void> {
  const { x, y } = await getElementCenter(cdp, selector);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
}
