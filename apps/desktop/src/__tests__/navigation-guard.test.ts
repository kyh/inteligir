import { describe, expect, it } from "vitest";

import {
  classifyNavigation,
  classifyWindowOpen,
  isPdfFrameMismatch,
  isSameOriginNavigation,
} from "@/main/navigation-guard";

// The two origins the shell ever pins to: a local `pnpm dev:web`, and the
// deployment a packaged build ships pointing at.
const DEV_URL = "http://localhost:5173";
const PROD_URL = "https://inteligir.com";

describe("isSameOriginNavigation", () => {
  describe("the pinned origin", () => {
    it("allows the origin itself", () => {
      expect(isSameOriginNavigation(DEV_URL, DEV_URL)).toBe(true);
      expect(isSameOriginNavigation(PROD_URL, PROD_URL)).toBe(true);
    });

    it("allows paths, queries, and fragments on it", () => {
      expect(isSameOriginNavigation("http://localhost:5173/", DEV_URL)).toBe(true);
      expect(isSameOriginNavigation("http://localhost:5173/some/path?q=1#frag", DEV_URL)).toBe(
        true,
      );
    });

    it("blocks a different host", () => {
      expect(isSameOriginNavigation("http://evil.com/", DEV_URL)).toBe(false);
    });

    it("blocks a different port", () => {
      expect(isSameOriginNavigation("http://localhost:5174/", DEV_URL)).toBe(false);
    });

    it("blocks a scheme switch on the same host:port (origin includes protocol)", () => {
      expect(isSameOriginNavigation("https://localhost:5173/", DEV_URL)).toBe(false);
    });

    it("blocks the prefix-spoof host a raw startsWith would allow", () => {
      expect(isSameOriginNavigation("http://localhost:5173.evil.com/", DEV_URL)).toBe(false);
    });

    it("blocks the userinfo spoof (loaded origin as credentials)", () => {
      expect(isSameOriginNavigation("http://localhost:5173@evil.com/", DEV_URL)).toBe(false);
    });

    it("blocks ws: on the same host:port (different origin)", () => {
      expect(isSameOriginNavigation("ws://localhost:5173/", DEV_URL)).toBe(false);
    });

    it("blocks file: targets", () => {
      expect(isSameOriginNavigation("file:///etc/passwd", DEV_URL)).toBe(false);
    });
  });

  describe("fail-closed edges", () => {
    it("nothing is same-origin when the shell has no origin", () => {
      expect(isSameOriginNavigation(DEV_URL, "")).toBe(false);
    });

    it("unparseable target is never same-origin", () => {
      expect(isSameOriginNavigation("not a url", DEV_URL)).toBe(false);
    });

    it("unparseable app origin matches nothing", () => {
      expect(isSameOriginNavigation(DEV_URL, "not a url")).toBe(false);
    });
  });

  // LATENT, unreachable in the app (pinned so a refactor notices): WHATWG
  // origins serialize every opaque-origin scheme to "null", so two unrelated
  // data: URLs would count as same-origin IF one were ever the app origin.
  // app-url.ts admits only http(s), so this cannot fire.
  it("latent: opaque-origin app URLs compare origin 'null' === 'null'", () => {
    expect(isSameOriginNavigation("data:text/html,b", "data:text/html,a")).toBe(true);
  });
});

describe("classifyNavigation", () => {
  it("allows same-origin navigation", () => {
    expect(classifyNavigation("http://localhost:5173/notes", DEV_URL)).toBe("allow");
    expect(classifyNavigation("https://inteligir.com/app#anchor", PROD_URL)).toBe("allow");
  });

  it("blocks cross-origin http(s) and routes it to the system browser", () => {
    expect(classifyNavigation("https://example.com/", DEV_URL)).toBe("block-and-open-external");
    expect(classifyNavigation("http://evil.com/", DEV_URL)).toBe("block-and-open-external");
    expect(classifyNavigation("https://example.com/", PROD_URL)).toBe("block-and-open-external");
  });

  it("blocks non-http schemes silently (no external open)", () => {
    expect(classifyNavigation("file:///etc/passwd", DEV_URL)).toBe("block");
    expect(classifyNavigation("javascript:alert(1)", DEV_URL)).toBe("block");
    expect(classifyNavigation("data:text/html,<h1>hi</h1>", DEV_URL)).toBe("block");
    expect(classifyNavigation("ws://localhost:5173/", DEV_URL)).toBe("block");
    expect(classifyNavigation("inteligir://today", DEV_URL)).toBe("block");
    expect(classifyNavigation("mailto:k@kyh.io", DEV_URL)).toBe("block");
    expect(classifyNavigation("about:blank", DEV_URL)).toBe("block");
  });

  it("blocks unparseable targets silently", () => {
    expect(classifyNavigation("not a url", DEV_URL)).toBe("block");
  });

  it("blocks everything when the shell has no origin", () => {
    expect(classifyNavigation("https://example.com/", "")).toBe("block-and-open-external");
    expect(classifyNavigation("file:///x", "")).toBe("block");
  });
});

describe("classifyWindowOpen", () => {
  it("denies http(s) popups but hands the URL to the system browser", () => {
    expect(classifyWindowOpen("https://example.com/")).toBe("deny-and-open-external");
    expect(classifyWindowOpen("http://example.com/")).toBe("deny-and-open-external");
  });

  it("even the app's own origin never gets a second window — system browser instead", () => {
    expect(classifyWindowOpen("http://localhost:5173/notes")).toBe("deny-and-open-external");
  });

  it("denies non-http schemes outright (no external open)", () => {
    expect(classifyWindowOpen("file:///etc/passwd")).toBe("deny");
    expect(classifyWindowOpen("javascript:alert(1)")).toBe("deny");
    expect(classifyWindowOpen("data:text/html,x")).toBe("deny");
    expect(classifyWindowOpen("inteligir://today")).toBe("deny");
    expect(classifyWindowOpen("not a url")).toBe("deny");
  });
});

// A `.pdf` sub-frame is the one frame the editor cannot sandbox
// (Chromium blocks its PDF viewer inside any sandboxed frame), so a server
// answering `text/html` to a `.pdf` URL would render attacker markup there.
const pdfFrame = (contentType: string | undefined) => ({
  url: "https://example.com/paper.pdf",
  resourceType: "subFrame",
  contentType,
});

describe("isPdfFrameMismatch", () => {
  it("blocks a .pdf frame serving html", () => {
    expect(isPdfFrameMismatch(pdfFrame("text/html"))).toBe(true);
    expect(isPdfFrameMismatch(pdfFrame("text/html; charset=utf-8"))).toBe(true);
  });

  it("allows a genuine PDF, including parameters and odd casing", () => {
    expect(isPdfFrameMismatch(pdfFrame("application/pdf"))).toBe(false);
    expect(isPdfFrameMismatch(pdfFrame("Application/PDF"))).toBe(false);
    expect(isPdfFrameMismatch(pdfFrame(" application/pdf ; qs=1"))).toBe(false);
    expect(isPdfFrameMismatch(pdfFrame("application/x-pdf"))).toBe(false);
  });

  it("allows a missing or empty Content-Type — Chromium sniffs those", () => {
    // Blocking them would break real static hosts and buy nothing: an attacker
    // controls their own headers and would simply omit it.
    expect(isPdfFrameMismatch(pdfFrame(undefined))).toBe(false);
    expect(isPdfFrameMismatch(pdfFrame(""))).toBe(false);
  });

  it("judges only sub-frames", () => {
    expect(isPdfFrameMismatch({ ...pdfFrame("text/html"), resourceType: "mainFrame" })).toBe(false);
    expect(isPdfFrameMismatch({ ...pdfFrame("text/html"), resourceType: "xhr" })).toBe(false);
  });

  it("ignores frames the renderer would never treat as a PDF", () => {
    // The html embeds (youtube, media) must stay untouched — they are
    // sandboxed and legitimately serve html.
    expect(
      isPdfFrameMismatch({
        url: "https://www.youtube.com/embed/abc",
        resourceType: "subFrame",
        contentType: "text/html",
      }),
    ).toBe(false);
  });

  it("matches the renderer's shape test, query and fragment included", () => {
    for (const url of [
      "https://example.com/a.pdf?download=1",
      "https://example.com/a.pdf#page=2",
      "https://example.com/a.PDF",
    ]) {
      expect(isPdfFrameMismatch({ url, resourceType: "subFrame", contentType: "text/html" })).toBe(
        true,
      );
    }
    // Not a pdf-shaped URL: `.pdf` must end the path, not merely appear.
    expect(
      isPdfFrameMismatch({
        url: "https://example.com/a.pdf.html",
        resourceType: "subFrame",
        contentType: "text/html",
      }),
    ).toBe(false);
  });
});
