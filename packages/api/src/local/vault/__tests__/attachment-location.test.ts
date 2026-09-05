import { describe, expect, it } from "vitest";

import {
  attachmentDir,
  formatAttachmentLocation,
  parseAttachmentLocation,
} from "../attachment-location";
import { DEFAULT_ATTACHMENT_LOCATION } from "../vault-schema";

describe("where a paste lands", () => {
  it("is the root, the note's own folder, or the named folder", () => {
    expect(attachmentDir({ kind: "root" }, "a/b.md")).toBe("");
    expect(attachmentDir({ kind: "beside-note" }, "a/b.md")).toBe("a");
    expect(attachmentDir({ kind: "beside-note" }, "b.md")).toBe("");
    expect(attachmentDir({ kind: "folder", path: "media/2026" }, "a/b.md")).toBe("media/2026");
  });

  it("falls back to the root when there is no note to be beside", () => {
    expect(attachmentDir({ kind: "beside-note" }, null)).toBe("");
  });

  it("defaults to the assets folder", () => {
    expect(attachmentDir(DEFAULT_ATTACHMENT_LOCATION, "a/b.md")).toBe("assets");
  });
});

describe("the CLI spelling", () => {
  it("parses what it prints", () => {
    for (const spelling of ["root", "beside-note", "folder:media/2026"]) {
      const location = parseAttachmentLocation(spelling);
      expect(location).not.toBeNull();
      if (location !== null) expect(formatAttachmentLocation(location)).toBe(spelling);
    }
  });

  it("normalizes the folder path and refuses what the vault would", () => {
    expect(parseAttachmentLocation("folder:media//2026/")).toEqual({
      kind: "folder",
      path: "media/2026",
    });
    expect(parseAttachmentLocation("folder:")).toBeNull();
    expect(parseAttachmentLocation("folder:../out")).toBeNull();
    expect(parseAttachmentLocation("assets")).toBeNull();
  });
});
