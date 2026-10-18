import { describe, expect, it } from "vitest";
import { sameDocument } from "../same-document";

const HELD = "file:///var/mobile/Containers/Data/Application/A1/Library/Caches/attachments";

describe("sameDocument", () => {
  it("is the document it was handed, however WebKit escapes it", () => {
    const raw = `${HELD}/Lecture notes.pdf`;
    const escaped = `${HELD}/Lecture%20notes.pdf`;
    expect(sameDocument(raw, raw)).toBe(true);
    expect(sameDocument(escaped, raw)).toBe(true);
    expect(sameDocument(raw, escaped)).toBe(true);
    expect(sameDocument(`${HELD}/Caf%C3%A9.pdf`, `${HELD}/Café.pdf`)).toBe(true);
  });

  it("drops a fragment, which never names another document", () => {
    expect(sameDocument(`${HELD}/a1b2.pdf#page=3`, `${HELD}/a1b2.pdf`)).toBe(true);
    expect(sameDocument(`${HELD}/Lecture%20notes.pdf#page=1`, `${HELD}/Lecture notes.pdf`)).toBe(
      true,
    );
  });

  it("compares an escape that does not decode as it is written", () => {
    expect(sameDocument(`${HELD}/100%.pdf`, `${HELD}/100%.pdf`)).toBe(true);
    expect(sameDocument(`${HELD}/100%25.pdf`, `${HELD}/100%.pdf`)).toBe(true);
  });

  it("is never another file, another folder or the web", () => {
    expect(sameDocument(`${HELD}/b.pdf`, `${HELD}/a.pdf`)).toBe(false);
    expect(sameDocument(`${HELD}/../a.pdf`, `${HELD}/a.pdf`)).toBe(false);
    expect(sameDocument("file:///etc/passwd", `${HELD}/a.pdf`)).toBe(false);
    expect(sameDocument("https://example.com/a.pdf", `${HELD}/a.pdf`)).toBe(false);
    expect(sameDocument(`${HELD}/a.pdf.html`, `${HELD}/a.pdf`)).toBe(false);
  });
});
