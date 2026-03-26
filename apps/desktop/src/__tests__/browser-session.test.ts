import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWindow = {
  isDestroyed: vi.fn().mockReturnValue(false),
  isVisible: vi.fn().mockReturnValue(false),
  webContents: {
    debugger: { attach: vi.fn(), detach: vi.fn() },
    on: vi.fn(),
    getURL: vi.fn().mockReturnValue(""),
  },
  on: vi.fn(),
  close: vi.fn(),
  show: vi.fn(),
};

vi.mock("electron", () => {
  // Must be a real constructor (called with `new`)
  function BrowserWindow() {
    return mockWindow;
  }
  return { BrowserWindow };
});

import { createBrowserSession } from "@/agent/browser/browser-session";
import type { BrowserSession } from "@/agent/browser/browser-session";

describe("browser-session", () => {
  let session: BrowserSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = createBrowserSession();
  });

  // ---------------------------------------------------------------------------
  // resolveSelector
  // ---------------------------------------------------------------------------

  describe("resolveSelector", () => {
    it("returns CSS selector as-is when not a ref", () => {
      // Need to call getWindow first to initialise, then set up refs
      session.updateRefs([]);
      expect(session.resolveSelector("#my-button")).toBe("#my-button");
      expect(session.resolveSelector(".class > div")).toBe(".class > div");
    });

    it("resolves @eN refs from the ref map", () => {
      session.updateRefs([
        { ref: "@e1", selector: "#submit-btn" },
        { ref: "@e2", selector: "input.name" },
      ]);
      expect(session.resolveSelector("@e1")).toBe("#submit-btn");
      expect(session.resolveSelector("@e2")).toBe("input.name");
    });

    it("throws for unknown refs", () => {
      session.updateRefs([{ ref: "@e1", selector: "#btn" }]);
      expect(() => session.resolveSelector("@e99")).toThrow('Unknown ref "@e99"');
    });
  });

  // ---------------------------------------------------------------------------
  // updateRefs
  // ---------------------------------------------------------------------------

  describe("updateRefs", () => {
    it("populates the ref map and clears old entries", () => {
      session.updateRefs([{ ref: "@e1", selector: "#old" }]);
      expect(session.resolveSelector("@e1")).toBe("#old");

      session.updateRefs([{ ref: "@e1", selector: "#new" }]);
      expect(session.resolveSelector("@e1")).toBe("#new");
    });

    it("clears previous refs when updating", () => {
      session.updateRefs([
        { ref: "@e1", selector: "#a" },
        { ref: "@e2", selector: "#b" },
      ]);
      session.updateRefs([{ ref: "@e1", selector: "#c" }]);
      expect(() => session.resolveSelector("@e2")).toThrow('Unknown ref "@e2"');
    });
  });

  // ---------------------------------------------------------------------------
  // hasLoadedPage
  // ---------------------------------------------------------------------------

  describe("hasLoadedPage", () => {
    it("returns false when no URL loaded (empty string)", () => {
      // getWindow() is called internally; the mock returns getURL() => ""
      expect(session.hasLoadedPage()).toBe(false);
    });

    it("returns false when URL is about:blank", () => {
      // Force getWindow to be called so browserWindow is set
      const contents = session.getContents();
      vi.mocked(contents.getURL).mockReturnValue("about:blank");
      expect(session.hasLoadedPage()).toBe(false);
    });

    it("returns true when a real URL is loaded", () => {
      const contents = session.getContents();
      vi.mocked(contents.getURL).mockReturnValue("https://example.com");
      expect(session.hasLoadedPage()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  describe("dispose", () => {
    it("marks session as disposed", () => {
      expect(session.isDisposed).toBe(false);
      session.dispose();
      expect(session.isDisposed).toBe(true);
    });

    it("is idempotent — second call does not throw", () => {
      session.getWindow(); // ensure window exists
      session.dispose();
      expect(() => session.dispose()).not.toThrow();
    });
  });
});
