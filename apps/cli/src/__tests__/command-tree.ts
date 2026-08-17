// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors —
// `collectLeafCommands` only; the rest is house. See ../../PROVENANCE.md.
//
// Shared by the surface fitness tests (--json enforcement + honest exits,
// guide coverage): the real program object, a walk of its leaf commands, and
// ONE runnable invocation per leaf — the table those tests drive.
//
// The invocation table is what makes "every leaf" mean every leaf: it is
// checked for completeness against the walked tree, so a command added
// without a row here fails the suite rather than quietly skipping the checks.

import type { Command } from "commander";
import type { CliDeps } from "../context";
import { buildProgram } from "../program";

export function testProgram(): Command {
  const deps: CliDeps = {
    env: {},
    resolveServer: async () => ({ baseUrl: "http://127.0.0.1:0", source: "explicit" }),
  };
  return buildProgram(deps);
}

export interface LeafCommand {
  path: string;
  cmd: Command;
}

export function collectLeafCommands(command: Command, prefix = ""): LeafCommand[] {
  const results: LeafCommand[] = [];
  for (const sub of command.commands) {
    const fullPath = prefix.length > 0 ? `${prefix} ${sub.name()}` : sub.name();
    if (sub.commands.length === 0) {
      results.push({ path: fullPath, cmd: sub });
    } else {
      results.push(...collectLeafCommands(sub, fullPath));
    }
  }
  return results;
}

/** Every leaf's argv, minus `--json`, against the seeded fixture state. */
export const LEAF_INVOCATIONS: Readonly<Record<string, readonly string[]>> = {
  "vault list": ["vault", "list"],
  "vault read": ["vault", "read", "notes/hello.md"],
  "vault write": ["vault", "write", "notes/written.md", "--content", "# Written\n"],
  "vault rename": ["vault", "rename", "notes/hello.md", "notes/renamed.md"],
  "vault delete": ["vault", "delete", "notes/hello.md"],
  "vault mkdir": ["vault", "mkdir", "projects"],
  "vault status": ["vault", "status"],
  "vault sync": ["vault", "sync"],
  search: ["search", "hello"],
  backlinks: ["backlinks", "notes/hello.md"],
  tags: ["tags"],
  "thread list": ["thread", "list"],
  "thread new": ["thread", "new", "do a thing"],
  "thread send": ["thread", "send", "thr_1", "and then?"],
  "thread show": ["thread", "show", "thr_1"],
  "thread wait": ["thread", "wait", "thr_1", "--timeout", "2", "--poll-interval", "20"],
  "thread archive": ["thread", "archive", "thr_1"],
  "interactions list": ["interactions", "list"],
  "interactions answer": ["interactions", "answer", "int_1", "allow_once"],
  status: ["status"],
  guide: ["guide"],
};
