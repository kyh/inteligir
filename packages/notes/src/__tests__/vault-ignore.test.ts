import { describe, expect, it } from "vitest";
import { createVaultIgnore, isGitignorePath } from "../knowledge/vault-ignore";
import type { GitignoreFile } from "../knowledge/vault-ignore";

const rules = (files: readonly GitignoreFile[], ignoreCase = false) =>
  createVaultIgnore(files, { ignoreCase });

describe("createVaultIgnore", () => {
  it("ignores nothing but the floor without a .gitignore", () => {
    const none = rules([]);
    expect(none.ignores("node_modules", "dir")).toBe(false);
    expect(none.ignores("node_modules/pkg/README.md", "file")).toBe(false);
    expect(none.ignores(".git", "dir")).toBe(true);
    expect(none.ignores("notes/.inteligir-tmp-abc", "file")).toBe(true);
    expect(none.ignores("", "dir")).toBe(false);
  });

  it("scopes a nested `*` to its own folder", () => {
    const nested = rules([{ content: "*\n", dir: "cache" }]);
    expect(nested.ignores("cache/a.md", "file")).toBe(true);
    expect(nested.ignores("cache/deep/b.md", "file")).toBe(true);
    expect(nested.ignores("cache/.gitignore", "file")).toBe(true);
    expect(nested.ignores("cache", "dir")).toBe(false);
    expect(nested.ignores("notes.md", "file")).toBe(false);
    expect(nested.ignores("cachet/a.md", "file")).toBe(false);
    expect(nested.ignores("notes/cache/a.md", "file")).toBe(false);
  });

  it("hides a named folder and everything under it, but not a file of that name", () => {
    const root = rules([{ content: "node_modules/\n", dir: "" }]);
    expect(root.ignores("node_modules", "dir")).toBe(true);
    expect(root.ignores("node_modules/pkg/README.md", "file")).toBe(true);
    expect(root.ignores("docs/node_modules/x.md", "file")).toBe(true);
    expect(root.ignores("node_modules", "file")).toBe(false);
  });

  it("lets a deeper .gitignore override a higher one", () => {
    const layered = rules([
      { content: "*.log\n", dir: "" },
      { content: "!keep.log\n", dir: "logs" },
    ]);
    expect(layered.ignores("a.log", "file")).toBe(true);
    expect(layered.ignores("logs/other.log", "file")).toBe(true);
    expect(layered.ignores("logs/keep.log", "file")).toBe(false);
    expect(layered.ignores("keep.log", "file")).toBe(true);
  });

  it("never re-includes what an ignored folder holds", () => {
    const shut = rules([
      { content: "build/\n", dir: "" },
      { content: "!keep.md\n", dir: "build" },
    ]);
    expect(shut.ignores("build/keep.md", "file")).toBe(true);
  });

  it("anchors a leading slash at the .gitignore's own folder", () => {
    const anchored = rules([{ content: "/out\n", dir: "site" }]);
    expect(anchored.ignores("site/out", "dir")).toBe(true);
    expect(anchored.ignores("out", "dir")).toBe(false);
    expect(anchored.ignores("site/nested/out", "dir")).toBe(false);
  });

  it("replaces a folder's rules when that .gitignore is read again", () => {
    const before = rules([{ content: "dist/\n", dir: "" }]);
    const after = before.with({ content: "", dir: "" });
    expect(before.ignores("dist/a.md", "file")).toBe(true);
    expect(after.ignores("dist/a.md", "file")).toBe(false);
  });

  it("folds case only when the repo does", () => {
    const files = [{ content: "Build/\n", dir: "" }];
    expect(rules(files, false).ignores("build/a.md", "file")).toBe(false);
    expect(rules(files, true).ignores("build/a.md", "file")).toBe(true);
  });

  it("reads past a leading byte order mark", () => {
    const bom = rules([{ content: "\uFEFFdist/\n", dir: "" }]);
    expect(bom.ignores("dist/a.md", "file")).toBe(true);
  });
});

describe("ignoresChangedPath", () => {
  const root = rules([
    { content: "node_modules/\ndist/\n*.tmp\n", dir: "" },
    { content: "*\n", dir: "cache" },
  ]);

  it("drops a path under an ignored folder, and one ignored as either kind", () => {
    expect(root.ignoresChangedPath("node_modules/pkg/index.js")).toBe(true);
    expect(root.ignoresChangedPath("scratch.tmp")).toBe(true);
    expect(root.ignoresChangedPath("notes/today.md")).toBe(false);
  });

  it("keeps a path a folder-only pattern names, since it may be a file", () => {
    expect(root.ignoresChangedPath("dist")).toBe(false);
  });

  it("keeps a .gitignore git would read, even one its own rules ignore", () => {
    expect(root.ignoresChangedPath(".gitignore")).toBe(false);
    expect(root.ignoresChangedPath("cache/.gitignore")).toBe(false);
    expect(root.ignoresChangedPath("node_modules/pkg/.gitignore")).toBe(true);
  });
});

describe("isGitignorePath", () => {
  it("names the rules file at any depth, and nothing else", () => {
    expect(isGitignorePath(".gitignore")).toBe(true);
    expect(isGitignorePath("a/b/.gitignore")).toBe(true);
    expect(isGitignorePath("a/.gitignore.md")).toBe(false);
    expect(isGitignorePath("a/gitignore")).toBe(false);
  });
});
