// git calls a file with a NUL in it binary and ripgrep stops reading at one, so a single raw byte
// hides a whole file from every diff and every search. the other C0 controls and DEL are
// invisible in review. an escape spells the same string and leaves the file text.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, trackedFiles } from "./repo";

const TEXT_FILE =
  /\.(?:[cm]?[jt]sx?|jsonc?|mdx?|css|sql|ya?ml|html|toml|txt|svg|webmanifest|plist)$/u;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const DELETE = 0x7f;

const isControlByte = (byte: number): boolean =>
  (byte < 0x20 && byte !== TAB && byte !== LINE_FEED && byte !== CARRIAGE_RETURN) ||
  byte === DELETE;

// the first one only: a file carrying one is already the finding.
const firstControlByte = (file: string): string | null => {
  const bytes = fs.readFileSync(path.join(REPO_ROOT, file));
  let line = 1;
  let lineStart = 0;
  for (const [offset, byte] of bytes.entries()) {
    if (byte === LINE_FEED) {
      line += 1;
      lineStart = offset + 1;
    } else if (isControlByte(byte)) {
      const hex = byte.toString(16).padStart(2, "0");
      return `  ${file}:${line}:${offset - lineStart + 1}  raw 0x${hex} (spell it \\u00${hex})`;
    }
  }
  return null;
};

describe("control bytes", () => {
  it("no tracked text file carries a raw control byte", () => {
    const files = trackedFiles().filter((file) => TEXT_FILE.test(file));
    if (!files.includes("package.json")) {
      throw new Error(
        "the tracked text files omit the root package.json — the sweep is broken, not the tree",
      );
    }
    const found = files.flatMap((file) => firstControlByte(file) ?? []);
    expect(
      found,
      `These tracked files carry a raw control byte.\n` +
        `  rule: git diffs a file holding a NUL as binary and ripgrep skips it, so a review shows no change and a search finds nothing; the other controls are invisible in a diff\n` +
        `  fix: write the escape the line names — a string literal's \\u0000 is the same runtime value\n` +
        `${found.join("\n")}\n`,
    ).toEqual([]);
  });
});
