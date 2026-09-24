// One matcher per .gitignore, scoped to its own folder. A single matcher rooted at the vault
// would re-scope a nested `*` to `**/*` and hide the whole tree. The host reads the files.

import ignore from "ignore";
import type { Ignore } from "ignore";
import { BOM } from "../markdown/parsed-offsets";
import { basenamePath, dirnamePath, isIgnoredEntryName } from "./vault-path";

export const GITIGNORE_NAME = ".gitignore";

export const isGitignorePath = (path: string): boolean => basenamePath(path) === GITIGNORE_NAME;

export interface GitignoreFile {
  // vault-relative; "" is the root
  readonly dir: string;
  readonly content: string;
}

export type VaultEntryKind = "file" | "dir";

export interface VaultIgnoreOptions {
  // the repo's core.ignorecase: the library folds case unless told, and git on a case-sensitive
  // disk does not
  readonly ignoreCase: boolean;
}

export interface VaultIgnore {
  // the floor (`.git`, the staging prefix), an ignored ancestor folder, or the deepest
  // .gitignore with a verdict on the entry
  ignores: (path: string, kind: VaultEntryKind) => boolean;
  // a watcher names a path without its kind, so it is ignored only as both; a .gitignore answers
  // for its folder, because its own edit is what moves the rules
  ignoresChangedPath: (path: string) => boolean;
  with: (file: GitignoreFile) => VaultIgnore;
}

interface ScopedMatcher {
  readonly dir: string;
  readonly depth: number;
  readonly matcher: Ignore;
}

const depthOf = (dir: string): number => (dir === "" ? 0 : dir.split("/").length);

// git skips a leading BOM; the library would read it as part of the first pattern
const withoutBom = (content: string): string =>
  content.startsWith(BOM) ? content.slice(BOM.length) : content;

const fromMatchers = (
  // deepest first: a lower .gitignore overrides a higher one
  matchers: readonly ScopedMatcher[],
  options: VaultIgnoreOptions,
): VaultIgnore => {
  const verdict = (path: string, kind: VaultEntryKind): boolean => {
    for (const { dir, matcher } of matchers) {
      if (dir !== "" && !path.startsWith(`${dir}/`)) {
        continue;
      }
      const rel = dir === "" ? path : path.slice(dir.length + 1);
      // the library knows a folder only by its trailing slash, which `dir/` patterns need
      const result = matcher.test(kind === "dir" ? `${rel}/` : rel);
      if (result.ignored) {
        return true;
      }
      if (result.unignored) {
        return false;
      }
    }
    return false;
  };

  const ignores = (path: string, kind: VaultEntryKind): boolean => {
    if (path === "") {
      return false;
    }
    const segments = path.split("/");
    if (segments.some((segment) => isIgnoredEntryName(segment))) {
      return true;
    }
    // git never enters an ignored folder, so a .gitignore below one cannot re-include anything
    for (let end = 1; end < segments.length; end += 1) {
      if (verdict(segments.slice(0, end).join("/"), "dir")) {
        return true;
      }
    }
    return verdict(path, kind);
  };

  return {
    ignores,
    ignoresChangedPath: (path) =>
      isGitignorePath(path)
        ? ignores(dirnamePath(path), "dir")
        : ignores(path, "file") && ignores(path, "dir"),
    with: (file) =>
      fromMatchers(
        [
          ...matchers.filter((scoped) => scoped.dir !== file.dir),
          {
            depth: depthOf(file.dir),
            dir: file.dir,
            matcher: ignore({ ignorecase: options.ignoreCase }).add(withoutBom(file.content)),
          },
        ].toSorted((a, b) => b.depth - a.depth),
        options,
      ),
  };
};

export const createVaultIgnore = (
  files: readonly GitignoreFile[],
  options: VaultIgnoreOptions,
): VaultIgnore => {
  let rules = fromMatchers([], options);
  for (const file of files) {
    rules = rules.with(file);
  }
  return rules;
};
