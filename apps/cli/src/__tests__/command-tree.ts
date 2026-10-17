import path from "node:path";
import type { CommandDef } from "citty";
import type { CliDeps } from "../context";
import { buildProgram } from "../program";
import { FIXTURE_REVISION_SHA } from "./fixture-server";

export const testProgram = (): CommandDef => {
  const deps: CliDeps = {
    env: {},
    openExternalUrl: async () => false,
    resolveServer: () => ({
      baseUrl: "http://127.0.0.1:0",
      dataDir: "/fixture/data",
      token: "unused",
      vaultDir: "/fixture/vault",
    }),
  };
  return buildProgram(deps);
};

// files a leaf reads from this Mac's disk: a file to save, a page's HTML, a Raindrop backup
const FIXTURE_FILES = path.join(import.meta.dirname, "fixtures");
export const FIXTURE_FILE_PATH = path.join(FIXTURE_FILES, "brochure.pdf");
export const FIXTURE_PAGE_PATH = path.join(FIXTURE_FILES, "page.html");
export const FIXTURE_RAINDROP_PATH = path.join(FIXTURE_FILES, "raindrop-export.csv");

// the saved link every leaf about one item names; json-flag-enforcement seeds it
export const FIXTURE_ITEM_PATH = "Reading/File over app.md";
export const FIXTURE_ITEM_URL = "https://example.test/file-over-app";

export const LEAF_INVOCATIONS = new Map<string, readonly string[]>([
  ["vault list", ["vault", "list"]],
  ["vault read", ["vault", "read", "notes/hello.md"]],
  ["vault history", ["vault", "history", "notes/hello.md", "--limit", "10"]],
  ["vault revision", ["vault", "revision", "notes/hello.md", FIXTURE_REVISION_SHA]],
  ["vault restore", ["vault", "restore", "notes/hello.md", FIXTURE_REVISION_SHA]],
  [
    "vault write",
    ["vault", "write", "notes/written.md", "--if-absent", "--content", "# Written\n"],
  ],
  ["vault rename", ["vault", "rename", "notes/hello.md", "notes/renamed.md"]],
  ["vault delete", ["vault", "delete", "notes/hello.md"]],
  ["vault mkdir", ["vault", "mkdir", "projects"]],
  ["vault new-id", ["vault", "new-id", "notes/copy.md"]],
  ["vault attachments", ["vault", "attachments", "beside-note"]],
  ["vault remote", ["vault", "remote", "https://git.example.test/vault.git"]],
  ["vault deleted", ["vault", "deleted"]],
  ["vault status", ["vault", "status"]],
  ["vault sync", ["vault", "sync"]],
  ["search", ["search", "hello"]],
  ["matches", ["matches", "Hello"]],
  ["backlinks", ["backlinks", "notes/hello.md"]],
  ["related", ["related", "notes/hello.md"]],
  ["tags", ["tags"]],
  ["tag rename", ["tag", "rename", "project", "work"]],
  ["tag add", ["tag", "add", "project", FIXTURE_ITEM_PATH]],
  ["tag remove", ["tag", "remove", "project", FIXTURE_ITEM_PATH]],
  ["save", ["save", FIXTURE_ITEM_URL, "--tags", "essay", "--no-wait"]],
  ["items", ["items", "--kind", "link,note", "--limit", "10"]],
  ["item show", ["item", "show", FIXTURE_ITEM_PATH]],
  ["item find", ["item", "find", FIXTURE_ITEM_URL]],
  ["item refresh", ["item", "refresh", FIXTURE_ITEM_PATH, "--no-wait"]],
  ["import raindrop", ["import", "raindrop", FIXTURE_RAINDROP_PATH]],
  ["import status", ["import", "status"]],
  ["import cancel", ["import", "cancel"]],
  ["action list", ["action", "list"]],
  ["action new", ["action", "new", "do a thing"]],
  ["action send", ["action", "send", "thr_1", "and then?"]],
  ["action show", ["action", "show", "thr_1"]],
  ["action stop", ["action", "stop", "thr_1"]],
  ["action wait", ["action", "wait", "thr_1", "--timeout", "2", "--poll-interval", "20"]],
  ["action archive", ["action", "archive", "thr_1"]],
  ["action changes", ["action", "changes", "thr_1"]],
  ["action undo", ["action", "undo", "thr_1"]],
  ["annotation list", ["annotation", "list", "notes/hello.md"]],
  [
    "annotation add",
    ["annotation", "add", "notes/hello.md", "Hello", "--note", "Needs a second pass"],
  ],
  ["annotation edit", ["annotation", "edit", "notes/hello.md", "c1", "Second pass done"]],
  ["annotation reply", ["annotation", "reply", "notes/hello.md", "c1", "Done"]],
  ["annotation remove", ["annotation", "remove", "notes/hello.md", "c1"]],
  ["interactions list", ["interactions", "list"]],
  ["interactions answer", ["interactions", "answer", "int_1", "allow_once"]],
  ["folders list", ["folders", "list"]],
  ["folders add", ["folders", "add", "/tmp/reference-docs"]],
  ["folders remove", ["folders", "remove", "/tmp/reference-docs"]],
  ["agents list", ["agents", "list"]],
  ["agents default", ["agents", "default", "codex"]],
  ["cloud status", ["cloud", "status"]],
  [
    "cloud login",
    ["cloud", "login", "--email", "owner@example.test", "--password", "correct-horse-battery"],
  ],
  ["cloud sync", ["cloud", "sync"]],
  ["status", ["status"]],
  ["open", ["open"]],
  ["guide", ["guide"]],
]);
