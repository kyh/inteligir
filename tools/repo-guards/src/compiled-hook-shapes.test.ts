// the React Compiler's own diagnostics stay empty for this, and react-query swallows the
// ReferenceError. the population is every non-test source importing react: the only files the
// transform touches.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTestFile, REPO_ROOT, sourceOf, workspaces, workspaceSourceFiles } from "./repo";

const HOOK_DEFINITION = /\b(?:function\s+|(?:const|let|var)\s+)(use[A-Z]\w*)\b/g;
const REACT_IMPORT = /from\s+["']react["']/;

interface NestedHook {
  name: string;
  line: number;
}

function nestedHookDefinitions(source: string): NestedHook[] {
  const found: NestedHook[] = [];
  const definitions = new Map<number, string>();
  for (const match of source.matchAll(HOOK_DEFINITION)) {
    const name = match[1];
    if (name !== undefined) definitions.set(match.index, name);
  }
  if (definitions.size === 0) return found;

  let depth = 0;
  let line = 1;
  // entering `${` pushes the depth to return to, so the `}` that closes it resumes template text.
  const templateReturn: number[] = [];
  type Mode = "code" | "line-comment" | "block-comment" | "single" | "double" | "template";
  let mode: Mode = "code";

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") line += 1;
    switch (mode) {
      case "line-comment":
        if (ch === "\n") mode = "code";
        break;
      case "block-comment":
        if (ch === "*" && next === "/") {
          mode = "code";
          i += 1;
        }
        break;
      case "single":
      case "double":
        if (ch === "\\") i += 1;
        else if ((mode === "single" && ch === "'") || (mode === "double" && ch === '"'))
          mode = "code";
        break;
      case "template":
        if (ch === "\\") i += 1;
        else if (ch === "`") mode = "code";
        else if (ch === "$" && next === "{") {
          templateReturn.push(depth);
          depth += 1;
          mode = "code";
          i += 1;
        }
        break;
      case "code": {
        const definition = definitions.get(i);
        if (definition !== undefined && depth > 0) found.push({ name: definition, line });
        if (ch === "/" && next === "/") mode = "line-comment";
        else if (ch === "/" && next === "*") mode = "block-comment";
        else if (ch === "'") mode = "single";
        else if (ch === '"') mode = "double";
        else if (ch === "`") mode = "template";
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          const resume = templateReturn.at(-1);
          if (resume !== undefined && depth === resume) {
            templateReturn.pop();
            mode = "template";
          }
        }
        break;
      }
    }
  }
  return found;
}

function compiledSourceFiles(): string[] {
  return workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isTestFile(file) && /\.tsx?$/.test(file))
    .filter((file) => REACT_IMPORT.test(sourceOf(file)));
}

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
      nestedHookDefinitions(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")).map(
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
