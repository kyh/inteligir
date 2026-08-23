// A root script named `<verb>:<suffix>` where the suffix names a workspace
// DIRECTORY has to drive that workspace. The names are the repo's map: someone
// who knows `apps/web` exists should be able to guess `pnpm dev:web` and be
// right, and `pnpm dev:site` — which drove `apps/web` for months — taught them
// a folder that does not exist.
//
// Only suffixes that match a directory are judged. `format:fix`, `lint:fix`
// and `clean:workspaces` name what they do rather than where, and nothing here
// asks them to change. The unqualified `dev` is the flagship by convention —
// no suffix because there is no ambiguity about which surface a notes app
// develops by default — so it has no directory to agree with either.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REPO_ROOT, workspaces } from "./repo";

const ROOT_MANIFEST = "package.json";

const scriptTableSchema = z.looseObject({ scripts: z.record(z.string(), z.string()) });

function rootScripts(): Record<string, string> {
  const file = path.join(REPO_ROOT, ROOT_MANIFEST);
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const parsed = scriptTableSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${ROOT_MANIFEST}: expected a "scripts" table of strings`);
  }
  return parsed.data.scripts;
}

describe("root script naming", () => {
  it("a script suffixed with a workspace directory drives that workspace", () => {
    // Directory basename → the manifest name a command actually filters on.
    // Both spellings count: `apps/launcher` publishes as `inteligir`, so
    // `package:launcher` names the folder and filters the package, and
    // demanding either one alone would be demanding the wrong thing.
    const byDir = new Map(workspaces().map((w) => [path.basename(w.dir), w]));

    const violations: string[] = [];
    for (const [script, command] of Object.entries(rootScripts())) {
      const suffix = script.split(":").at(-1);
      if (suffix === undefined) continue;
      const workspace = byDir.get(suffix);
      if (workspace === undefined) continue;
      if (command.includes(workspace.name) || command.includes(workspace.dir)) continue;
      violations.push(
        `MISNAMED  ${script}\n` +
          `  runs: ${command}\n` +
          `  rule: "${script}" ends in "${suffix}", which is the directory ${workspace.dir} — so it has to drive ${workspace.name}\n` +
          `  fix: point the script at ${workspace.name}, or rename it after the workspace it really drives`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every workspace a root script claims to drive exists", () => {
    // The inverse, and the half that catches a DELETED workspace: a script
    // still filtering `@repo/gone` is a command that fails at the moment
    // someone trusts the name.
    const names = new Set(workspaces().map((w) => w.name));
    const violations: string[] = [];
    for (const [script, command] of Object.entries(rootScripts())) {
      for (const filtered of command.matchAll(/--filter[= ]([^\s]+)/gu)) {
        const target = (filtered[1] ?? "").replace(/\.\.\.$/u, "");
        if (target === "" || names.has(target)) continue;
        violations.push(
          `UNKNOWN WORKSPACE  ${script}\n` +
            `  runs: ${command}\n` +
            `  rule: --filter names a workspace, and "${target}" is not one\n` +
            `  fix: filter a package that exists, or drop the script with the workspace it outlived`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
