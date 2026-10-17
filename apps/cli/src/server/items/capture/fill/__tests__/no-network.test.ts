// the fill worker reads html it is handed and nothing else: no file the worker's entry reaches in
// this package (everything under fill/, and the modules beside it it imports, such as css-urls and
// fill-protocol) may import a socket, a resolver or a process, so the page's own instructions (its
// links, its scripts, defuddle's async extractors) can reach nothing from this thread. The build
// holds the bundle itself to the same, packages included (FILL_WORKER_REFUSED_BUILTINS in
// apps/cli/scripts/build.ts).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FILL = path.resolve(import.meta.dirname, "..");
const CAPTURE = path.resolve(FILL, "..");
const WORKER_ENTRY = path.join(CAPTURE, "item-fill-worker.ts");
const BANNED =
  /\bfrom\s+["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|cluster)(?:\/[\w/]+)?["']|\bimport\(\s*["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|cluster)\b|\bimport\s+["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|cluster)\b/u;
const RELATIVE_IMPORT = /(?:\bfrom|\bimport\(?)\s*["'](?<spec>\.{1,2}\/[^"']+)["']/gu;

// the source with its comments taken out, so a line commented away never reads as code; a `//`
// after a colon or a quote is a url's, not a comment's
const withoutComments = (source: string): string =>
  source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/(?<before>^|[^:"'`])\/\/.*$/gmu, "$<before>");

const code = (file: string): string => withoutComments(readFileSync(file, "utf-8"));

const resolved = (from: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(from), spec);
  return (
    [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base].find(
      (candidate) => /\.tsx?$/u.test(candidate) && existsSync(candidate),
    ) ?? null
  );
};

// every file of this package the entry reaches through relative imports, the entry included
const closure = (entry: string): string[] => {
  const seen = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const match of code(file).matchAll(RELATIVE_IMPORT)) {
      const next = resolved(file, match.groups?.spec ?? "");
      if (next !== null && !seen.has(next)) {
        pending.push(next);
      }
    }
  }
  return [...seen];
};

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sources(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });

const reached = [...new Set([...sources(FILL), ...closure(WORKER_ENTRY)])].toSorted();

describe("the fill worker's program", () => {
  it("reaches the modules beside fill/ it imports, not only fill/ itself", () => {
    const names = reached.map((file) => path.relative(CAPTURE, file));
    expect(names).toContain("css-urls.ts");
    expect(names).toContain("fill-protocol.ts");
  });

  it.each(reached.map((file) => [path.relative(CAPTURE, file), file]))(
    "%s imports no network or process module",
    (_name, file) => {
      expect(code(file)).not.toMatch(BANNED);
    },
  );

  it("reads a line commented away as no code", () => {
    expect(withoutComments('// globalThis.fetch = x;\nconst a = "https://b";\n')).toBe(
      '\nconst a = "https://b";\n',
    );
  });

  it("refuses fetch before it listens for a job", () => {
    const entry = code(WORKER_ENTRY);
    const refused = entry.search(/^globalThis\.fetch = /mu);
    const listens = entry.search(/\bport\.on\(\s*"message"/u);
    expect(refused).toBeGreaterThan(-1);
    expect(listens).toBeGreaterThan(refused);
  });
});
