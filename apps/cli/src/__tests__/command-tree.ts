// The real program object, and ONE runnable invocation per leaf — the table
// the surface fitness tests (--json enforcement + honest exits, guide
// coverage) drive. The walk itself is shipped code (`src/command-tree.ts`),
// because `--help` and the unknown-flag gate resolve against the same tree;
// these tests read the surface through exactly what the CLI reads it through.
//
// The invocation table is what makes "every leaf" mean every leaf: it is
// checked for completeness against the walked tree, so a command added
// without a row here fails the suite rather than quietly skipping the checks.

import type { CommandDef } from "citty";
import type { CliDeps } from "../context";
import { buildProgram } from "../program";

export function testProgram(): CommandDef {
  const deps: CliDeps = {
    env: {},
    resolveServer: async () => ({ baseUrl: "http://127.0.0.1:0", source: "explicit" }),
  };
  return buildProgram(deps);
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
  "connectors list": ["connectors", "list"],
  "proposals list": ["proposals", "list"],
  "proposals show": ["proposals", "show", "prp_1"],
  "proposals accept": ["proposals", "accept", "prp_1"],
  "proposals reject": ["proposals", "reject", "prp_1"],
  "sync status": ["sync", "status"],
  "sync pair": ["sync", "pair", "ABCD-EFGH"],
  "sync push": ["sync", "push"],
  status: ["status"],
  guide: ["guide"],
};
