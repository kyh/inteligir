import { describe, expect, it } from "vitest";

import { isValidHash, isValidVaultPath } from "../vault-file";

describe("isValidHash", () => {
  it("accepts a 64-char lowercase hex digest and rejects everything else", () => {
    expect(isValidHash("a".repeat(64))).toBe(true);
    expect(isValidHash("A".repeat(64))).toBe(false); // uppercase
    expect(isValidHash("a".repeat(63))).toBe(false); // too short
    expect(isValidHash("g".repeat(64))).toBe(false); // non-hex
    expect(isValidHash("")).toBe(false);
  });
});

describe("isValidVaultPath", () => {
  it("accepts well-formed vault-relative POSIX paths", () => {
    for (const ok of [
      "todo.md",
      "notes/todo.md",
      "a/b/c/deep.md",
      "assets/image.png",
      "journal/2026-07-20.md",
      "a file with spaces.md",
      "unicode-éü.md",
      "..prefix-not-a-segment.md", // dots are only special as a WHOLE segment
      "trailing.dots..md",
    ]) {
      expect(isValidVaultPath(ok)).toBe(true);
    }
  });

  it("rejects the traversal / escape vectors a confined vault must never resolve", () => {
    for (const bad of [
      "", // empty
      "/etc/passwd", // absolute
      "../evil.md", // parent traversal
      "notes/../../evil.md", // traversal mid-path
      "..", // bare parent
      ".", // bare current-dir segment
      "a/./b.md", // current-dir segment
      "a/../b.md", // parent segment
      "notes//todo.md", // empty segment (double slash)
      "/leading.md", // leading slash → empty first segment + absolute
      "trailing/", // trailing slash → empty last segment
      "a\\b.md", // Windows separator
      "C:/evil.md", // drive letter
      "c:evil.md", // drive letter, no slash
      "bad\u0000name.md", // NUL
      "cr\rlf\nname.md", // control chars
      "de\u007fl.md", // DEL
      `${"x".repeat(1025)}.md`, // over-length
    ]) {
      expect(isValidVaultPath(bad)).toBe(false);
    }
  });
});
