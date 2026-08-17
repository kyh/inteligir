// ---------------------------------------------------------------------------
// The app's environment contract, held across the two files that have to
// agree about it.
//
// `apps/app/src/node/config.ts` declares every variable the server reads.
// `apps/app/turbo.json` decides which of them survive `turbo run dev` — turbo
// runs in STRICT env mode, so anything the task does not name is stripped
// before the process starts. The two drifting apart has no error message on
// either side: `INTELIGIR_AGENT=scripted pnpm dev` simply boots the default
// agent, and the variable the docs promise does nothing.
//
// So the declaration is the source and the task list is checked against it.
// Neither side is hand-copied here: the names come from the module's own
// exported table, and the list comes from the real turbo.json.
// ---------------------------------------------------------------------------

import { ENV_VAR_NAMES } from "@repo/app/node/config";
import { describe, expect, it } from "vitest";
import { sourceOf } from "./repo";

const TURBO_CONFIG = "apps/app/turbo.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function objectAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) {
    throw new Error(`${TURBO_CONFIG}: expected an object at "${key}"`);
  }
  return value;
}

/** turbo.json is JSONC. `sourceOf` drops full-line comments, which is every
 *  comment this repo's turbo configs use. */
function passThroughEnvOfDevTask(): string[] {
  const parsed: unknown = JSON.parse(sourceOf(TURBO_CONFIG));
  if (!isRecord(parsed)) {
    throw new Error(`${TURBO_CONFIG}: expected a JSON object`);
  }
  const names = objectAt(objectAt(parsed, "tasks"), "dev")["passThroughEnv"];
  if (!Array.isArray(names)) {
    throw new Error(`${TURBO_CONFIG}: tasks.dev.passThroughEnv must be an array`);
  }
  return names.map((name: unknown) => {
    if (typeof name !== "string") {
      throw new Error(`${TURBO_CONFIG}: tasks.dev.passThroughEnv must hold strings`);
    }
    return name;
  });
}

describe("the app's dev task passes through every declared env var", () => {
  it("turbo.json's dev.passThroughEnv IS config.ts's declared set", () => {
    const declared = [...ENV_VAR_NAMES].toSorted();
    const passedThrough = passThroughEnvOfDevTask().toSorted();

    const violations = [
      ...declared
        .filter((name) => !passedThrough.includes(name))
        .map(
          (name) =>
            `STRIPPED ENV VAR  ${name}\n` +
            `  rule: turbo runs in strict env mode — a variable apps/app/src/node/config.ts declares and this task does not name is dropped before the server starts, silently\n` +
            `  fix: add "${name}" to tasks.dev.passThroughEnv in ${TURBO_CONFIG}`,
        ),
      ...passedThrough
        .filter((name) => !declared.includes(name))
        .map(
          (name) =>
            `UNDECLARED ENV VAR  ${name}\n` +
            `  rule: dev.passThroughEnv states what the server READS; nothing in apps/app/src/node/config.ts declares this one\n` +
            `  fix: remove "${name}" from ${TURBO_CONFIG}, or declare it in that module's ENV_VARS`,
        ),
    ];
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("reads a real list from a real file", () => {
    // A lookup that silently found nothing would satisfy the assertion above
    // for the wrong reason on both sides.
    expect(ENV_VAR_NAMES).toContain("INTELIGIR_AGENT");
    expect(passThroughEnvOfDevTask()).toContain("INTELIGIR_DATA_DIR");
  });
});
