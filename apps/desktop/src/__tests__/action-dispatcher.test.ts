import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CDPClient } from "@/agent/browser/cdp-client";

// Mock CDP adapter — we test those functions separately
vi.mock("@/agent/browser/cdp-adapter", () => ({
  cdpClick: vi.fn(),
  cdpType: vi.fn(),
  cdpPress: vi.fn(),
  cdpHover: vi.fn(),
}));

// Mock snapshot builder
vi.mock("@/agent/browser/snapshot-builder", () => ({
  buildSnapshot: vi.fn().mockResolvedValue("[snapshot]"),
}));

// Mock cdp-client evaluate to return values for get_url, get_title, scroll
vi.mock("@/agent/browser/cdp-client", () => ({
  evaluate: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchAction } from "@/agent/browser/action-dispatcher";
import type { ActionContext } from "@/agent/browser/action-dispatcher";
import type { BrowserAction } from "@/agent/browser/schema";
import type { BrowserSession } from "@/agent/browser/browser-session";
import { evaluate } from "@/agent/browser/cdp-client";

const mockCDP = {
  send: vi.fn().mockResolvedValue({}),
  on: vi.fn(),
  off: vi.fn(),
  close: vi.fn(),
} as unknown as CDPClient;

function createMockSession(overrides?: Partial<BrowserSession>): BrowserSession {
  return {
    ensureConnected: vi.fn().mockResolvedValue(mockCDP),
    hasLoadedPage: vi.fn().mockReturnValue(true),
    updateRefs: vi.fn(),
    resolveSelector: vi.fn().mockImplementation((s: string) => s),
    listTabs: vi.fn().mockReturnValue([]),
    newTab: vi.fn().mockResolvedValue({ id: "t1", url: "", current: true }),
    switchTab: vi.fn().mockReturnValue({ id: "t1", url: "", current: true }),
    closeTab: vi.fn().mockResolvedValue(undefined),
    currentTabId: vi.fn().mockReturnValue("t1"),
    dispose: vi.fn(),
    isDisposed: false,
    ...overrides,
  };
}

function textContent(result: { content: { type: string; text?: string }[] }): string {
  const item = result.content[0];
  if (item && "text" in item) return item.text as string;
  return "";
}

describe("action-dispatcher", () => {
  let session: BrowserSession;
  let ctx: ActionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    session = createMockSession();
    ctx = { session };
  });

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------

  describe("close action", () => {
    it("calls session.dispose()", async () => {
      const result = await dispatchAction({ action: "close" }, ctx);
      expect(session.dispose).toHaveBeenCalledOnce();
      expect(textContent(result)).toBe("Browser tab closed");
    });
  });

  // ---------------------------------------------------------------------------
  // open — validation
  // ---------------------------------------------------------------------------

  describe("open action", () => {
    it("rejects when url is missing", async () => {
      const result = await dispatchAction({ action: "open" }, ctx);
      expect(textContent(result)).toContain("url is required");
    });

    it("rejects non-http scheme", async () => {
      const result = await dispatchAction({ action: "open", url: "file:///etc/passwd" }, ctx);
      expect(textContent(result)).toContain("not allowed");
    });

    it("rejects invalid URL", async () => {
      const result = await dispatchAction({ action: "open", url: "not-a-url" }, ctx);
      expect(textContent(result)).toContain("Invalid URL");
    });

    it("navigates for valid http URL", async () => {
      // Mock awaitNavigation — Page.loadEventFired fires immediately
      vi.mocked(mockCDP.on).mockImplementation((event, handler) => {
        if (event === "Page.loadEventFired")
          setTimeout(() => (handler as () => void)(), 0);
      });
      const result = await dispatchAction({ action: "open", url: "https://example.com" }, ctx);
      expect(textContent(result)).toContain("Navigated to");
      expect(mockCDP.send).toHaveBeenCalledWith("Page.navigate", { url: "https://example.com" });
    });
  });

  // ---------------------------------------------------------------------------
  // page-required guard
  // ---------------------------------------------------------------------------

  describe("page-required guard", () => {
    it("returns error when no page loaded for non-open actions", async () => {
      session = createMockSession({ hasLoadedPage: vi.fn().mockReturnValue(false) });
      ctx = { session };

      const actions: BrowserAction["action"][] = [
        "click", "fill", "snapshot", "get_url", "scroll", "screenshot",
      ];
      for (const action of actions) {
        const result = await dispatchAction({ action } as BrowserAction, ctx);
        expect(textContent(result)).toContain("No page loaded");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // get_url
  // ---------------------------------------------------------------------------

  describe("get_url action", () => {
    it("returns current URL", async () => {
      vi.mocked(evaluate).mockResolvedValueOnce("https://example.com");
      const result = await dispatchAction({ action: "get_url" }, ctx);
      expect(textContent(result)).toBe("https://example.com");
    });
  });

  // ---------------------------------------------------------------------------
  // get_title
  // ---------------------------------------------------------------------------

  describe("get_title action", () => {
    it("returns current title", async () => {
      vi.mocked(evaluate).mockResolvedValueOnce("Example");
      const result = await dispatchAction({ action: "get_title" }, ctx);
      expect(textContent(result)).toBe("Example");
    });
  });

  // ---------------------------------------------------------------------------
  // scroll
  // ---------------------------------------------------------------------------

  describe("scroll action", () => {
    it("scrolls down by default amount", async () => {
      const result = await dispatchAction({ action: "scroll" }, ctx);
      expect(textContent(result)).toBe("Scrolled down 500px");
      expect(evaluate).toHaveBeenCalledWith(mockCDP, "window.scrollBy(0, 500)");
    });

    it("scrolls up with negative delta", async () => {
      const result = await dispatchAction(
        { action: "scroll", direction: "up", amount: 300 },
        ctx,
      );
      expect(textContent(result)).toBe("Scrolled up 300px");
      expect(evaluate).toHaveBeenCalledWith(mockCDP, "window.scrollBy(0, -300)");
    });
  });

  // ---------------------------------------------------------------------------
  // fill — validation
  // ---------------------------------------------------------------------------

  describe("fill action", () => {
    it("requires selector", async () => {
      const result = await dispatchAction({ action: "fill", text: "hi" }, ctx);
      expect(textContent(result)).toContain("selector is required");
    });

    it("requires text", async () => {
      const result = await dispatchAction({ action: "fill", selector: "#input" }, ctx);
      expect(textContent(result)).toContain("text is required");
    });
  });

  // ---------------------------------------------------------------------------
  // click — validation
  // ---------------------------------------------------------------------------

  describe("click action", () => {
    it("requires selector", async () => {
      const result = await dispatchAction({ action: "click" }, ctx);
      expect(textContent(result)).toContain("selector is required");
    });
  });

  // ---------------------------------------------------------------------------
  // press — validation
  // ---------------------------------------------------------------------------

  describe("press action", () => {
    it("requires text (key name)", async () => {
      const result = await dispatchAction({ action: "press" }, ctx);
      expect(textContent(result)).toContain("text (key name) is required");
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate — validation
  // ---------------------------------------------------------------------------

  describe("evaluate action", () => {
    it("requires script", async () => {
      const result = await dispatchAction({ action: "evaluate" }, ctx);
      expect(textContent(result)).toContain("script is required");
    });
  });
});
