// BASE_KIT is the gate's editor and the fill worker's: the server's worker thread canonicalizes a
// saved page with it, so nothing it reaches may be a React half, a stylesheet or a node built-in.
// The fill program's tsconfig compiles no jsx, which catches a .tsx; this catches the rest (a
// `platejs/react` import from a .ts file type-checks fine and drags React into the worker).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR = path.resolve(import.meta.dirname, "..");

// a bare specifier the headless closure may never name
const REFUSED = [
  /^react(?:$|\/|-dom)/u,
  /\/react$/u,
  /^@repo\/ui\//u,
  /^lucide-react/u,
  /^katex/u,
  /^pele(?:$|\/)/u,
  /\.css$/u,
  /^node:/u,
];

const resolveLocal = (specifier: string, fromFile: string): string | null => {
  let base: string;
  if (specifier.startsWith("@repo/editor/")) {
    base = path.join(EDITOR, specifier.slice("@repo/editor/".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`${fromFile} imports ${specifier}, which names no file`);
};

// value imports only: a type-only import is erased, so it reaches nothing at run time
const valueSpecifiers = (file: string): string[] => {
  const source = fs
    .readFileSync(file, "utf-8")
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/^\s*\/\/.*$/gmu, "");
  const found: string[] = [];
  for (const match of source.matchAll(
    /(?:import|export)\s+(?<type>type\s+)?(?<clause>[^"';]*?)\s*from\s*["'](?<specifier>[^"']+)["']/gu,
  )) {
    const specifier = match.groups?.specifier;
    if (specifier !== undefined && match.groups?.type === undefined) {
      found.push(specifier);
    }
  }
  for (const match of source.matchAll(/import\s*\(\s*["'](?<specifier>[^"']+)["']\s*\)/gu)) {
    const specifier = match.groups?.specifier;
    if (specifier !== undefined) {
      found.push(specifier);
    }
  }
  for (const match of source.matchAll(/^import\s+["'](?<specifier>[^"']+)["']/gmu)) {
    const specifier = match.groups?.specifier;
    if (specifier !== undefined) {
      found.push(specifier);
    }
  }
  return found;
};

// every file the entry's value imports reach, and each bare specifier with the file that names it
interface Closure {
  files: Set<string>;
  bare: Map<string, string>;
}

const closureOf = (entry: string): Closure => {
  const files = new Set<string>();
  const bare = new Map<string, string>();
  const pending = [path.join(EDITOR, entry)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    for (const specifier of valueSpecifiers(file)) {
      const local = resolveLocal(specifier, file);
      if (local === null) {
        bare.set(specifier, path.relative(EDITOR, file));
      } else {
        pending.push(local);
      }
    }
  }
  return { bare, files };
};

describe("the headless kits", () => {
  for (const entry of ["kits/base-kit.ts", "markdown/markdown-doc.ts"]) {
    it(`${entry} reaches no React half, stylesheet or node built-in`, () => {
      const { bare, files } = closureOf(entry);
      const tsx = [...files].filter((file) => file.endsWith(".tsx"));
      expect(
        tsx.map((file) => path.relative(EDITOR, file)),
        "a .tsx file in the closure",
      ).toEqual([]);
      const refused = [...bare].filter(([specifier]) =>
        REFUSED.some((pattern) => pattern.test(specifier)),
      );
      expect(refused, "a refused module in the closure (specifier, importer)").toEqual([]);
    });
  }

  it("keeps every base kit in kits/headless/", () => {
    const { files } = closureOf("kits/base-kit.ts");
    const kits = [...files]
      .map((file) => path.relative(EDITOR, file))
      .filter((file) => file.startsWith("kits/") && file !== "kits/base-kit.ts");
    expect(
      kits.filter((file) => !file.startsWith("kits/headless/") && file !== "kits/markdown-kit.ts"),
    ).toEqual([]);
  });
});
