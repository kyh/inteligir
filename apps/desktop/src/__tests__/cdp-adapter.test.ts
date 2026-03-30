import { describe, it, expect, vi, beforeEach } from "vitest";
import { getElementCenter, cdpClick, cdpType, cdpPress, cdpHover } from "@/agent/browser/cdp-adapter";
import type { CDPClient } from "@/agent/browser/cdp-client";

function createMockCDP() {
  return {
    send: vi.fn().mockResolvedValue({ result: { value: null } }),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
  } as unknown as CDPClient;
}

/** Set up the mock to return a value from Runtime.evaluate */
function mockEvaluateResult(cdp: CDPClient, value: unknown) {
  vi.mocked(cdp.send).mockResolvedValueOnce({ result: { value } });
}

describe("cdp-adapter", () => {
  let cdp: CDPClient;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  describe("getElementCenter", () => {
    it("returns center coords from Runtime.evaluate", async () => {
      mockEvaluateResult(cdp, { x: 100, y: 200 });
      const result = await getElementCenter(cdp, "#btn");
      expect(result).toEqual({ x: 100, y: 200 });
      expect(cdp.send).toHaveBeenCalledWith("Runtime.evaluate", expect.objectContaining({
        returnByValue: true,
      }));
    });

    it("throws when element not found (null result)", async () => {
      mockEvaluateResult(cdp, null);
      await expect(getElementCenter(cdp, ".missing")).rejects.toThrow(
        "Element not found: .missing",
      );
    });
  });

  describe("cdpClick", () => {
    it("sends mousePressed then mouseReleased at element center", async () => {
      mockEvaluateResult(cdp, { x: 50, y: 75 });

      await cdpClick(cdp, "#link");

      // 1 evaluate + 2 mouse events
      expect(cdp.send).toHaveBeenCalledTimes(3);
      expect(cdp.send).toHaveBeenNthCalledWith(2, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 50,
        y: 75,
        button: "left",
        clickCount: 1,
      });
      expect(cdp.send).toHaveBeenNthCalledWith(3, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 50,
        y: 75,
        button: "left",
        clickCount: 1,
      });
    });
  });

  describe("cdpType", () => {
    it("calls Input.insertText with the text", async () => {
      await cdpType(cdp, "hello world");
      expect(cdp.send).toHaveBeenCalledWith("Input.insertText", { text: "hello world" });
    });
  });

  describe("cdpPress", () => {
    it("sends keyDown then keyUp for known keys", async () => {
      await cdpPress(cdp, "Enter");

      expect(cdp.send).toHaveBeenCalledTimes(2);
      expect(cdp.send).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
      expect(cdp.send).toHaveBeenNthCalledWith(2, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    });

    it("sends keyDown then keyUp for Tab", async () => {
      await cdpPress(cdp, "Tab");

      expect(cdp.send).toHaveBeenCalledTimes(2);
      expect(cdp.send).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
    });

    it("handles unknown keys with fallback code", async () => {
      await cdpPress(cdp, "x");

      expect(cdp.send).toHaveBeenCalledTimes(2);
      expect(cdp.send).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "x",
        code: "KeyX",
        windowsVirtualKeyCode: undefined,
      });
    });
  });

  describe("cdpHover", () => {
    it("sends mouseMoved at element center", async () => {
      mockEvaluateResult(cdp, { x: 30, y: 40 });

      await cdpHover(cdp, ".item");

      // 1 evaluate + 1 mouse event
      expect(cdp.send).toHaveBeenCalledTimes(2);
      expect(cdp.send).toHaveBeenNthCalledWith(2, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 30,
        y: 40,
      });
    });
  });
});
