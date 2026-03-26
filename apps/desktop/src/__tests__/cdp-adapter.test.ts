import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({}));

import { getElementCenter, cdpClick, cdpType, cdpPress, cdpHover } from "@/agent/browser/cdp-adapter";
import type { WebContents } from "electron";

function createMockContents() {
  return {
    executeJavaScript: vi.fn(),
    debugger: { sendCommand: vi.fn() },
  } as unknown as WebContents;
}

describe("cdp-adapter", () => {
  let contents: WebContents;

  beforeEach(() => {
    contents = createMockContents();
  });

  // ---------------------------------------------------------------------------
  // getElementCenter
  // ---------------------------------------------------------------------------

  describe("getElementCenter", () => {
    it("returns center coords from executeJavaScript", async () => {
      vi.mocked(contents.executeJavaScript).mockResolvedValue({ x: 100, y: 200 });
      const result = await getElementCenter(contents, "#btn");
      expect(result).toEqual({ x: 100, y: 200 });
      expect(contents.executeJavaScript).toHaveBeenCalledOnce();
      // Ensure selector is embedded in the script
      const script = vi.mocked(contents.executeJavaScript).mock.calls[0]![0] as string;
      expect(script).toContain("#btn");
    });

    it("throws when element not found (null result)", async () => {
      vi.mocked(contents.executeJavaScript).mockResolvedValue(null);
      await expect(getElementCenter(contents, ".missing")).rejects.toThrow(
        "Element not found: .missing",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // cdpClick
  // ---------------------------------------------------------------------------

  describe("cdpClick", () => {
    it("sends mousePressed then mouseReleased at element center", async () => {
      vi.mocked(contents.executeJavaScript).mockResolvedValue({ x: 50, y: 75 });
      const sendCommand = vi.mocked(contents.debugger.sendCommand);

      await cdpClick(contents, "#link");

      expect(sendCommand).toHaveBeenCalledTimes(2);
      expect(sendCommand).toHaveBeenNthCalledWith(1, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 50,
        y: 75,
        button: "left",
        clickCount: 1,
      });
      expect(sendCommand).toHaveBeenNthCalledWith(2, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 50,
        y: 75,
        button: "left",
        clickCount: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // cdpType
  // ---------------------------------------------------------------------------

  describe("cdpType", () => {
    it("calls Input.insertText with the text", async () => {
      const sendCommand = vi.mocked(contents.debugger.sendCommand);
      await cdpType(contents, "hello world");
      expect(sendCommand).toHaveBeenCalledOnce();
      expect(sendCommand).toHaveBeenCalledWith("Input.insertText", { text: "hello world" });
    });
  });

  // ---------------------------------------------------------------------------
  // cdpPress
  // ---------------------------------------------------------------------------

  describe("cdpPress", () => {
    it("sends keyDown then keyUp for known keys", async () => {
      const sendCommand = vi.mocked(contents.debugger.sendCommand);
      await cdpPress(contents, "Enter");

      expect(sendCommand).toHaveBeenCalledTimes(2);
      expect(sendCommand).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
      expect(sendCommand).toHaveBeenNthCalledWith(2, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    });

    it("sends keyDown then keyUp for Tab", async () => {
      const sendCommand = vi.mocked(contents.debugger.sendCommand);
      await cdpPress(contents, "Tab");

      expect(sendCommand).toHaveBeenCalledTimes(2);
      expect(sendCommand).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
    });

    it("handles unknown keys with fallback code", async () => {
      const sendCommand = vi.mocked(contents.debugger.sendCommand);
      await cdpPress(contents, "x");

      expect(sendCommand).toHaveBeenCalledTimes(2);
      expect(sendCommand).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "x",
        code: "KeyX",
        windowsVirtualKeyCode: undefined,
      });
      expect(sendCommand).toHaveBeenNthCalledWith(2, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "x",
        code: "KeyX",
        windowsVirtualKeyCode: undefined,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // cdpHover
  // ---------------------------------------------------------------------------

  describe("cdpHover", () => {
    it("sends mouseMoved at element center", async () => {
      vi.mocked(contents.executeJavaScript).mockResolvedValue({ x: 30, y: 40 });
      const sendCommand = vi.mocked(contents.debugger.sendCommand);

      await cdpHover(contents, ".item");

      expect(sendCommand).toHaveBeenCalledOnce();
      expect(sendCommand).toHaveBeenCalledWith("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 30,
        y: 40,
      });
    });
  });
});
