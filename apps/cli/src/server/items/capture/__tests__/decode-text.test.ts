import { describe, expect, it } from "vitest";

import { decodeText } from "../decode-text";

const latin1 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "latin1"));
const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf-8"));

describe("decodeText", () => {
  it("reads UTF-8 when nothing names a charset", () => {
    expect(decodeText(utf8("<p>café — ok</p>"), null)).toBe("<p>café — ok</p>");
  });

  it("honours the response's declared charset", () => {
    expect(decodeText(latin1("<p>café</p>"), "iso-8859-1")).toBe("<p>café</p>");
  });

  it("reads a meta charset in the first 1024 bytes, either spelling", () => {
    expect(decodeText(latin1('<meta charset="windows-1252"><p>café</p>'), null)).toBe(
      '<meta charset="windows-1252"><p>café</p>',
    );
    expect(
      decodeText(
        latin1('<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><p>é</p>'),
        null,
      ),
    ).toContain("<p>é</p>");
  });

  it("ignores a meta charset past the first 1024 bytes", () => {
    const page = latin1(`${" ".repeat(1100)}<meta charset="windows-1252"><p>café</p>`);
    expect(decodeText(page, null)).toContain("caf�");
  });

  it("lets a byte-order mark win over every declaration", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("<p>é</p>")]);
    expect(decodeText(bytes, "iso-8859-1")).toBe("<p>é</p>");
    const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from("<p>é</p>", "utf16le")]);
    expect(decodeText(utf16, null)).toBe("<p>é</p>");
  });

  it("falls through a label no decoder knows, and never throws", () => {
    expect(decodeText(utf8("<p>é</p>"), "x-no-such-charset")).toBe("<p>é</p>");
    expect(decodeText(utf8('<meta charset="bogus"><p>é</p>'), null)).toContain("<p>é</p>");
    expect(decodeText(new Uint8Array([0xff, 0xff, 0x41]), null)).toBe("��A");
  });

  it("refuses UTF-16 from a meta tag, which an ASCII prescan could not have read", () => {
    expect(decodeText(utf8('<meta charset="utf-16"><p>é</p>'), null)).toContain("<p>é</p>");
  });
});
