// the React Compiler's own diagnostics stay empty for this, and react-query swallows the
// ReferenceError. the population is every non-test source importing react: the only files the
// transform touches.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTestFile, REPO_ROOT, sourceOf, workspaces, workspaceSourceFiles } from "./repo";

const HOOK_DEFINITION = /\b(?:function\s+|(?:const|let|var)\s+)(?<name>use[A-Z]\w*)\b/gu;
const REACT_IMPORT = /from\s+["']react["']/u;

interface NestedHook {
  name: string;
  line: number;
}

type Mode = "code" | "line-comment" | "block-comment" | "single" | "double" | "template";

interface Scan {
  index: number;
  mode: Mode;
  depth: number;
  // entering `${` pushes the depth to return to, so the `}` that closes it resumes template text.
  templateReturn: number[];
}

const stepQuoted = (scan: Scan, ch: string | undefined): void => {
  if (ch === "\\") {
    scan.index += 1;
  } else if ((scan.mode === "single" && ch === "'") || (scan.mode === "double" && ch === '"')) {
    scan.mode = "code";
  }
};

const stepTemplate = (scan: Scan, ch: string | undefined, next: string | undefined): void => {
  if (ch === "\\") {
    scan.index += 1;
  } else if (ch === "`") {
    scan.mode = "code";
  } else if (ch === "$" && next === "{") {
    scan.templateReturn.push(scan.depth);
    scan.depth += 1;
    scan.mode = "code";
    scan.index += 1;
  }
};

const stepCode = (scan: Scan, ch: string | undefined, next: string | undefined): void => {
  if (ch === "/" && next === "/") {
    scan.mode = "line-comment";
  } else if (ch === "/" && next === "*") {
    scan.mode = "block-comment";
  } else if (ch === "'") {
    scan.mode = "single";
  } else if (ch === '"') {
    scan.mode = "double";
  } else if (ch === "`") {
    scan.mode = "template";
  } else if (ch === "{") {
    scan.depth += 1;
  } else if (ch === "}") {
    scan.depth -= 1;
    const resume = scan.templateReturn.at(-1);
    if (resume !== undefined && scan.depth === resume) {
      scan.templateReturn.pop();
      scan.mode = "template";
    }
  }
};

const nestedHookDefinitions = (source: string): NestedHook[] => {
  const found: NestedHook[] = [];
  const definitions = new Map<number, string>();
  for (const match of source.matchAll(HOOK_DEFINITION)) {
    const name = match.groups?.name;
    if (name !== undefined) {
      definitions.set(match.index, name);
    }
  }
  if (definitions.size === 0) {
    return found;
  }

  let line = 1;
  const scan: Scan = { depth: 0, index: 0, mode: "code", templateReturn: [] };

  while (scan.index < source.length) {
    const ch = source[scan.index];
    const next = source[scan.index + 1];
    if (ch === "\n") {
      line += 1;
    }
    switch (scan.mode) {
      case "line-comment": {
        if (ch === "\n") {
          scan.mode = "code";
        }
        break;
      }
      case "block-comment": {
        if (ch === "*" && next === "/") {
          scan.mode = "code";
          scan.index += 1;
        }
        break;
      }
      case "single":
      case "double": {
        stepQuoted(scan, ch);
        break;
      }
      case "template": {
        stepTemplate(scan, ch, next);
        break;
      }
      case "code": {
        const definition = definitions.get(scan.index);
        if (definition !== undefined && scan.depth > 0) {
          found.push({ line, name: definition });
        }
        stepCode(scan, ch, next);
        break;
      }
      // no default
    }
    scan.index += 1;
  }
  return found;
};

const compiledSourceFiles = (): string[] =>
  workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isTestFile(file) && /\.tsx?$/u.test(file))
    .filter((file) => REACT_IMPORT.test(sourceOf(file)));

describe("hooks in compiled sources are defined at module scope", () => {
  it("the scanner catches a hook nested in a function and ignores braces in strings and comments", () => {
    const nested = nestedHookDefinitions(`
      const text = "{ not a scope"; // { neither
      /* { nor this */
      const tpl = \`{ text \${ "}" } more\`;
      function mount() {
        const fetches = 0;
        function useCounted() { return fetches; }
        return useCounted;
      }
      export function useTopLevel() {}
    `);
    expect(nested.map((hook) => hook.name)).toEqual(["useCounted"]);
  });

  it("no react-importing source file defines a hook inside another function", () => {
    const offenders = compiledSourceFiles().flatMap((file) =>
      nestedHookDefinitions(fs.readFileSync(path.join(REPO_ROOT, file), "utf-8")).map(
        (hook) => `  ${file}:${hook.line} — ${hook.name}`,
      ),
    );
    expect(
      offenders,
      [
        "HOOKS DEFINED INSIDE ANOTHER FUNCTION",
        ...offenders,
        "  rule: the React Compiler hoists a hook's closures to module scope, so a hook",
        "  defined inside a function loses that function's locals at call time — and the",
        "  compiler reports no diagnostic. Define the hook at module scope and pass what",
        "  it needs as arguments.",
      ].join("\n"),
    ).toEqual([]);
  });
});
