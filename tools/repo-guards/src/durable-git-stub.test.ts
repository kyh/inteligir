// durable-git ships TypeScript source and no .d.ts, so the Worker typechecks against a hand-written
// stub; tsc never reads the real package, so a bump that changes its shapes still typechecks.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo";

const LOCKFILE = "pnpm-lock.yaml";
const STUB = "apps/web/src/worker/types/durable-git.d.ts";

// a package key at the lockfile's top indent; a peer suffix `(…)` and the key's colon end it.
const RESOLVED_DURABLE_GIT = /^ {2}'?durable-git@(?<version>[^:(\s']+)/gmu;

const resolvedVersions = (): string[] => {
  const source = fs.readFileSync(path.join(REPO_ROOT, LOCKFILE), "utf-8");
  const versions = new Set<string>();
  for (const match of source.matchAll(RESOLVED_DURABLE_GIT)) {
    const version = match.groups?.version;
    if (version !== undefined) {
      versions.add(version);
    }
  }
  return [...versions].toSorted();
};

const transcribedVersion = (): string => {
  const source = fs.readFileSync(path.join(REPO_ROOT, STUB), "utf-8");
  const version = /\bdurable-git@(?<version>\d+\.\d+\.\d+\S*?)[;.,]?\s/u.exec(source)?.groups
    ?.version;
  if (version === undefined) {
    throw new Error(
      `${STUB}: no "durable-git@<version>" in its header to hold against ${LOCKFILE}`,
    );
  }
  return version;
};

describe("the durable-git type stub", () => {
  it("was transcribed from the version the lockfile resolves", () => {
    const resolved = resolvedVersions();
    const [version, ...others] = resolved;
    if (version === undefined) {
      throw new Error(`${LOCKFILE} resolves no durable-git — the sweep is broken, not the tree`);
    }
    if (others.length > 0) {
      throw new Error(
        `${LOCKFILE} resolves durable-git at ${resolved.join(", ")} — teach durable-git-stub.test.ts which one the Worker bundles`,
      );
    }
    expect(
      transcribedVersion(),
      `${STUB} was transcribed from another durable-git than the ${version} the lockfile resolves.\n` +
        `  rule: the stub is what tsc checks the Worker against, and tsc never reads the package the bundler ships\n` +
        `  fix: re-transcribe the stub from durable-git@${version}'s source, re-check the Worker's reliance on its internals — apps/web/src/worker/vault/git-remote.ts (the cell DELETE, the R2 raw/ and pack/ prefixes, the negotiation-body ceiling), apps/web/src/worker/vault/receive-pack.ts (the x-changed and x-commit-time headers, report-status's "fetch first", and usage(), which only patches/durable-git@<version>.patch adds: carry the patch to the new version or drop it for a release's own size) and apps/web/src/worker/vault/commit-changes.ts (listTree's tree oid and its lenient name decode) — then update the header`,
    ).toBe(version);
  });
});
