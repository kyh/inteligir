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
export const LEAF_INVOCATIONS = new Map<string, readonly string[]>([
  ["vault list", ["vault", "list"]],
  ["vault read", ["vault", "read", "notes/hello.md"]],
  ["vault write", ["vault", "write", "notes/written.md", "--content", "# Written\n"]],
  ["vault rename", ["vault", "rename", "notes/hello.md", "notes/renamed.md"]],
  ["vault delete", ["vault", "delete", "notes/hello.md"]],
  ["vault mkdir", ["vault", "mkdir", "projects"]],
  ["trash list", ["trash", "list"]],
  ["trash put", ["trash", "put", "notes/hello.md"]],
  ["trash restore", ["trash", "restore", "Trash/notes/hello.md"]],
  ["trash purge", ["trash", "purge", "Trash/notes/hello.md"]],
  ["vault status", ["vault", "status"]],
  ["vault sync", ["vault", "sync"]],
  ["search", ["search", "hello"]],
  ["backlinks", ["backlinks", "notes/hello.md"]],
  ["related", ["related", "notes/hello.md"]],
  ["tags", ["tags"]],
  ["action list", ["action", "list"]],
  ["action new", ["action", "new", "do a thing"]],
  ["action send", ["action", "send", "thr_1", "and then?"]],
  ["action show", ["action", "show", "thr_1"]],
  ["action wait", ["action", "wait", "thr_1", "--timeout", "2", "--poll-interval", "20"]],
  ["action archive", ["action", "archive", "thr_1"]],
  ["comment list", ["comment", "list", "notes/hello.md"]],
  ["comment add", ["comment", "add", "notes/hello.md", "Needs a second pass"]],
  ["comment reply", ["comment", "reply", "notes/hello.md", "c1", "Done"]],
  ["comment resolve", ["comment", "resolve", "notes/hello.md", "c1"]],
  ["comment remove", ["comment", "remove", "notes/hello.md", "c1"]],
  ["interactions list", ["interactions", "list"]],
  ["interactions answer", ["interactions", "answer", "int_1", "allow_once"]],
  ["connectors list", ["connectors", "list"]],
  ["connectors add", ["connectors", "add", "exa2", "--url", "https://mcp.exa.ai/mcp"]],
  ["connectors remove", ["connectors", "remove", "context7"]],
  ["folders list", ["folders", "list"]],
  ["folders add", ["folders", "add", "/tmp/reference-docs"]],
  ["folders remove", ["folders", "remove", "/tmp/reference-docs"]],
  ["sync status", ["sync", "status"]],
  ["sync pair", ["sync", "pair"]],
  ["sync push", ["sync", "push"]],
  ["import-moss", ["import-moss", "--dry-run"]],
  ["status", ["status"]],
  ["guide", ["guide"]],
]);
