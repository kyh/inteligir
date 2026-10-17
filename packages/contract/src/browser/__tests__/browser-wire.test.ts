import { describe, expect, it } from "vitest";
import {
  BROWSER_WIRE_FLOOR,
  BROWSER_WIRE_VERSION,
  browserHostReplySchema,
  browserHostRequestSchema,
  CAPTURE_HTML_MAX_CHARS,
} from "../browser-wire";
import type { BrowserSave } from "../browser-wire";

const page = {
  html: "<html></html>",
  selection: null,
  title: "A page",
  url: "https://example.test/a",
};

const over = (save: BrowserSave): boolean =>
  !browserHostRequestSchema.safeParse({ save, type: "save", v: 1 }).success;

describe("the browser wire", () => {
  it("is versioned with a floor at or below it", () => {
    expect(BROWSER_WIRE_FLOOR).toBeLessThanOrEqual(BROWSER_WIRE_VERSION);
  });

  it("drops what either end does not know, so a newer peer's field is no error", () => {
    const request = browserHostRequestSchema.parse({
      future: true,
      save: { keepCopy: false, page: { ...page, favicon: "x" }, target: "page", tabId: 4 },
      type: "save",
      v: 1,
    });
    expect(request).toEqual({
      save: { keepCopy: false, page, target: "page" },
      type: "save",
      v: 1,
    });
    const reply = browserHostReplySchema.parse({
      appVersion: "1",
      library: "L",
      type: "hello",
      v: 1,
      x: 1,
    });
    expect(reply).toEqual({ appVersion: "1", library: "L", type: "hello", v: 1 });
  });

  it("reads a refusal it never heard of as a plain failure", () => {
    expect(
      browserHostReplySchema.parse({ detail: "", reason: "out-of-ink", type: "refused", v: 3 }),
    ).toEqual({ detail: "", reason: "failed", type: "refused", v: 3 });
  });

  it("holds the page's html, a selection and an image's bytes to their caps", () => {
    expect(
      over({
        keepCopy: false,
        page: { ...page, html: "x".repeat(CAPTURE_HTML_MAX_CHARS + 1) },
        target: "page",
      }),
    ).toBe(true);
    expect(
      over({
        keepCopy: false,
        page: { ...page, html: "x".repeat(CAPTURE_HTML_MAX_CHARS) },
        target: "page",
      }),
    ).toBe(false);
    expect(
      over({ keepCopy: false, page: { ...page, selection: { text: "" } }, target: "page" }),
    ).toBe(true);
    expect(
      over({
        keepCopy: false,
        page: { ...page, selection: { text: "x".repeat(20_001) } },
        target: "page",
      }),
    ).toBe(true);
    const tenMegabytes = Math.ceil((10 * 1024 * 1024) / 3) * 4;
    expect(
      over({
        src: { base64: "A".repeat(tenMegabytes + 1), kind: "bytes", mime: "image/png" },
        target: "image",
      }),
    ).toBe(true);
    expect(
      over({
        src: { base64: "A".repeat(tenMegabytes), kind: "bytes", mime: "image/png" },
        target: "image",
      }),
    ).toBe(false);
  });

  it("names its three requests and nothing else", () => {
    expect(browserHostRequestSchema.safeParse({ type: "hello", v: 1 }).success).toBe(true);
    expect(browserHostRequestSchema.safeParse({ type: "open-app", v: 1 }).success).toBe(true);
    expect(browserHostRequestSchema.safeParse({ type: "delete-everything", v: 1 }).success).toBe(
      false,
    );
    expect(browserHostRequestSchema.safeParse({ type: "hello", v: 1.5 }).success).toBe(false);
  });
});
