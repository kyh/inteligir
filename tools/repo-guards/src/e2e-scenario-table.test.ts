// the e2e README's scenario table is what a reader picks `--only` names from, and it is written
// by hand beside a registry that grows by a line; read from both, the two cannot drift apart.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf } from "./repo";

const RUNNER = "tools/e2e/src/run.ts";
const README = "tools/e2e/README.md";
const TABLE_HEADING = "## The scenarios";

const SCENARIO_IMPORT =
  /import\s*\{\s*(?<ident>\w+)\s*\}\s*from\s*["']\.\/scenarios\/(?<file>[\w-]+)["']/gu;
const REGISTRY = /const SCENARIOS\b[^=]*=\s*\[(?<body>[^\]]*)\]/u;

// the scenario's own `name`, the first after its export: a scenario's boots name instances too
const scenarioName = (ident: string, file: string): string => {
  const source = sourceOf(file);
  const exported = source.indexOf(`export const ${ident}`);
  const name = exported === -1 ? null : /\bname:\s*"(?<name>[^"]+)"/u.exec(source.slice(exported));
  if (name?.groups?.name === undefined) {
    throw new Error(
      `${file}: no \`name\` after \`export const ${ident}\`.\n` +
        `  rule: tools/repo-guards/src/e2e-scenario-table.test.ts reads a scenario's name from its exported object\n` +
        `  fix: export the scenario as \`export const ${ident}: Scenario = { name: "…", … }\``,
    );
  }
  return name.groups.name;
};

const registryNames = (): string[] => {
  const runner = sourceOf(RUNNER);
  const imports = new Map<string, string>();
  for (const match of runner.matchAll(SCENARIO_IMPORT)) {
    const { ident, file } = match.groups ?? {};
    if (ident !== undefined && file !== undefined) {
      imports.set(ident, `tools/e2e/src/scenarios/${file}.ts`);
    }
  }
  const body = REGISTRY.exec(runner)?.groups?.body;
  if (body === undefined) {
    throw new Error(`${RUNNER}: no \`const SCENARIOS = [ … ]\` to read`);
  }
  return body
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((ident) => {
      const file = imports.get(ident);
      if (file === undefined) {
        throw new Error(
          `${RUNNER}: SCENARIOS lists \`${ident}\` with no \`import { ${ident} } from "./scenarios/…"\``,
        );
      }
      return scenarioName(ident, file);
    });
};

// the first column of the table under the heading; a row whose name cell is blank continues the
// row above it
const tableNames = (): string[] => {
  const lines = fs.readFileSync(path.join(REPO_ROOT, README), "utf-8").split("\n");
  const heading = lines.indexOf(TABLE_HEADING);
  if (heading === -1) {
    throw new Error(`${README}: no "${TABLE_HEADING}" heading above the scenario table`);
  }
  const rows: string[] = [];
  for (const line of lines.slice(heading + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    if (line.startsWith("|")) {
      rows.push(line.split("|")[1]?.trim() ?? "");
    }
  }
  const [, separator, ...body] = rows;
  if (separator === undefined || !/^-+$/u.test(separator)) {
    throw new Error(`${README}: the rows under "${TABLE_HEADING}" are not a markdown table`);
  }
  return body.filter((name) => name !== "");
};

describe("the e2e README's scenario table", () => {
  it("names every registered scenario, in the registry's order", () => {
    const registered = registryNames();
    const documented = tableNames();
    expect(registered.length, `${RUNNER}: SCENARIOS read as empty`).toBeGreaterThan(0);
    const missing = registered.filter((name) => !documented.includes(name));
    const extra = documented.filter((name) => !registered.includes(name));
    expect(
      documented,
      `THE SCENARIO TABLE DRIFTED FROM SCENARIOS\n` +
        `  missing from ${README}: ${missing.length === 0 ? "none" : missing.join(", ")}\n` +
        `  in ${README} but not registered: ${extra.length === 0 ? "none" : extra.join(", ")}\n` +
        `  rule: the table under "${TABLE_HEADING}" has one row per scenario in ${RUNNER}'s SCENARIOS, in its order\n` +
        `  fix: add, drop or reorder the rows to match what \`pnpm e2e --list\` prints`,
    ).toEqual(registered);
  });
});
