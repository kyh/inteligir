// An icon-only button shows the product's tooltip, never the OS's. Detection is textual: a raw
// `<button` whose opening tag carries `title=`. Every `Button`-based icon button is covered by
// @repo/ui's own rule, so only raw buttons are swept here.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

// a row here is a decision, not a backlog.
const NATIVE_TITLE_ALLOWED = new Map<string, string>([
  [
    "block-draggable.tsx",
    "one Tooltip root per block in a long note is a cost nobody measured; the two per-block handles keep the native title.",
  ],
]);

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

// the opening tag ends at the first `>` outside braces that is not an arrow's: an attribute
// like `onClick={() => {}}` holds both.
function openingTags(text: string): Array<{ tag: string; line: number }> {
  const tags: Array<{ tag: string; line: number }> = [];
  let from = text.indexOf("<button");
  while (from !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = from; i < text.length; i += 1) {
      const char = text[i];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && text[i - 1] !== "=") {
        end = i;
        break;
      }
    }
    if (end === -1) break;
    tags.push({ tag: text.slice(from, end + 1), line: text.slice(0, from).split("\n").length });
    from = text.indexOf("<button", end);
  }
  return tags;
}

describe("raw buttons in the editor", () => {
  it("carry no native title, so the tooltip is always the product's", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const name = path.basename(file);
      if (NATIVE_TITLE_ALLOWED.has(name)) continue;
      for (const { tag, line } of openingTags(fs.readFileSync(file, "utf8"))) {
        if (/\btitle=/u.test(tag)) {
          offenders.push(`  ${path.relative(SRC, file)}:${String(line)}`);
        }
      }
    }
    expect(
      offenders,
      `A raw <button> carries title=. An icon-only button wraps in <Tooltip content=…> from\n` +
        `@repo/ui/components/tooltip with an aria-label; a button with text on its face gets\n` +
        `neither. Record a deliberate native title in NATIVE_TITLE_ALLOWED\n` +
        `(packages/editor/src/__tests__/icon-button-tooltips.test.ts) with its reason:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("every allowance still names a file that carries a native title", () => {
    const stale = [...NATIVE_TITLE_ALLOWED.keys()].filter((name) => {
      const file = sources(SRC).find((candidate) => path.basename(candidate) === name);
      if (file === undefined) return true;
      return !openingTags(fs.readFileSync(file, "utf8")).some(({ tag }) => /\btitle=/u.test(tag));
    });
    expect(
      stale,
      `NATIVE_TITLE_ALLOWED names files with no native title left — delete these rows:\n` +
        stale.map((name) => `  ${name}`).join("\n"),
    ).toEqual([]);
  });
});
