import { describe, expect, it } from "vitest";

import { mdLinkTarget, mdLinkUrl } from "./link-extract";

describe(mdLinkUrl, () => {
  it("writes a path `mdLinkTarget` reads back as itself", () => {
    for (const path of [
      "assets/Invoice #12.pdf",
      "assets/a%20b.pdf",
      "assets/100%.pdf",
      "a b.md",
    ]) {
      expect(mdLinkTarget(mdLinkUrl(path)), path).toBe(path);
    }
  });
});

describe(mdLinkTarget, () => {
  it("names the path an md url points at, percent-decoded, its anchor left off", () => {
    expect(mdLinkTarget("My%20Note.md#top")).toBe("My Note.md");
    expect(mdLinkTarget("../../a/x%20y.png")).toBe("../../a/x y.png");
    expect(mdLinkTarget("note")).toBe("note");
  });

  it("keeps a url that does not decode as it was written", () => {
    expect(mdLinkTarget("bad%zz.md")).toBe("bad%zz.md");
  });

  it("names nothing for an external, protocol-relative or same-note url", () => {
    for (const url of [
      "https://example.com/x.md",
      "mailto:a@b.c",
      "C:\\notes\\x.md",
      "//cdn.example.com/x.md",
      "#heading",
      "",
    ]) {
      expect(mdLinkTarget(url), url).toBeNull();
    }
  });
});
