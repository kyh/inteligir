import { describe, it, expect, vi, beforeEach } from "vitest";

import { createBrowserSession } from "@/agent/browser/browser-session";
import type { BrowserSession } from "@/agent/browser/browser-session";

// Mock the cdp-client module — browser-session uses discoverChromeEndpoint, openNewTab, CDPClient, closeTab
vi.mock("@/agent/browser/cdp-client", () => {
  const mockCDP = {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
  };
  return {
    CDPClient: { connect: vi.fn().mockResolvedValue(mockCDP) },
    discoverChromeEndpoint: vi.fn().mockResolvedValue("http://127.0.0.1:9222"),
    openNewTab: vi.fn().mockResolvedValue({
      id: "target-1",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/target-1",
    }),
    closeTab: vi.fn().mockResolvedValue(undefined),
  };
});

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
    it("returns false before any navigation", () => {
      expect(session.hasLoadedPage()).toBe(false);
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
      session.dispose();
      expect(() => session.dispose()).not.toThrow();
    });
  });
});
