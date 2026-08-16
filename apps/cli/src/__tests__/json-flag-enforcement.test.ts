// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors —
// apps/cli/src/__tests__/json-flag-enforcement.test.ts, adapted to this
// program. Every leaf command must take --json: the flag is the CLI's whole
// machine-readability contract, so a new command cannot ship without it.

import { describe, expect, it } from "vitest";
import { collectLeafCommands, testProgram } from "./command-tree";

// Commands intentionally excluded from the --json requirement.
const EXCLUDED_COMMANDS = new Set<string>();

describe("CLI --json flag enforcement", () => {
  it("every leaf command supports --json", () => {
    const commands = collectLeafCommands(testProgram());
    expect(commands.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const { path, cmd } of commands) {
      if (EXCLUDED_COMMANDS.has(path)) {
        continue;
      }
      if (!cmd.options.some((option) => option.long === "--json")) {
        missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });
});
