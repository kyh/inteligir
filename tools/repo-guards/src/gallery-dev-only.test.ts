// the gallery ships in no bundle the Worker serves: gallery.html is its only entry, under a vite
// config of its own. one import of it from the site's source would put it in the deployed bundle,
// and nothing else would fail.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importsOf, isTestFile, sourceOf, workspaces, workspaceSourceFiles } from "./repo";
import type { Workspace } from "./repo";
import { GALLERY_DIR } from "./ui-package";

const RULE = "the gallery is gallery.html, served by pnpm dev:gallery alone";

const tsconfigSchema = z.looseObject({
  compilerOptions: z.looseObject({ paths: z.record(z.string(), z.array(z.string())) }),
});

interface Alias {
  prefix: string;
  dir: string;
}

const galleryWorkspace = (): Workspace => {
  const found = workspaces().find((workspace) => GALLERY_DIR.startsWith(`${workspace.dir}/`));
  if (found === undefined) {
    throw new Error(`${GALLERY_DIR} is inside no workspace`);
  }
  return found;
};

const siteSourceDir = (workspace: Workspace): string => `${workspace.dir}/src`;

// read from the workspace's tsconfig, so an alias added there is one this guard follows too.
const aliasesOf = (workspace: Workspace): Alias[] => {
  const configPath = `${workspace.dir}/tsconfig.json`;
  const parsed = tsconfigSchema.safeParse(JSON.parse(sourceOf(configPath)));
  if (!parsed.success) {
    throw new Error(`${configPath}: expected a "compilerOptions.paths" map of alias → targets`);
  }
  return Object.entries(parsed.data.compilerOptions.paths).flatMap(([key, [target]]) =>
    key.endsWith("/*") && target?.endsWith("/*") === true
      ? [{ dir: path.posix.join(workspace.dir, target.slice(0, -2)), prefix: key.slice(0, -1) }]
      : [],
  );
};

// the repo-relative module a specifier names, or null for a package.
const resolveSpecifier = (
  aliases: readonly Alias[],
  importer: string,
  specifier: string,
): string | null => {
  if (specifier.startsWith(".")) {
    return path.posix.join(path.posix.dirname(importer), specifier);
  }
  const alias = aliases.find((candidate) => specifier.startsWith(candidate.prefix));
  return alias === undefined
    ? null
    : path.posix.join(alias.dir, specifier.slice(alias.prefix.length));
};

const insideGallery = (resolved: string | null): boolean =>
  resolved !== null && (resolved === GALLERY_DIR || resolved.startsWith(`${GALLERY_DIR}/`));

describe("the gallery stays a dev page", () => {
  it("no site source outside the gallery imports it", () => {
    const workspace = galleryWorkspace();
    const aliases = aliasesOf(workspace);
    const importers: string[] = [];
    for (const file of workspaceSourceFiles(workspace)) {
      // a test is bundled into nothing the Worker serves.
      if (
        !file.startsWith(`${siteSourceDir(workspace)}/`) ||
        insideGallery(file) ||
        isTestFile(file)
      ) {
        continue;
      }
      for (const specifier of importsOf(file)) {
        if (insideGallery(resolveSpecifier(aliases, file, specifier))) {
          importers.push(`  ${file} imports "${specifier}"`);
        }
      }
    }
    expect(
      importers,
      `Site source imports the gallery under ${GALLERY_DIR}.\n` +
        `  rule: ${RULE}, never a route or a module the Worker bundles\n` +
        `  fix: import the @repo/ui component the gallery demos instead:\n${importers.join("\n")}`,
    ).toEqual([]);
  });

  it("reads the gallery both by its alias and by a relative path", () => {
    const workspace = galleryWorkspace();
    const aliases = aliasesOf(workspace);
    const sourceDir = siteSourceDir(workspace);
    const alias = aliases.find((candidate) => candidate.dir === sourceDir);
    if (alias === undefined) {
      throw new Error(`${workspace.dir}/tsconfig.json aliases nothing to ${sourceDir}`);
    }
    const importer = `${sourceDir}/routes/index.tsx`;
    const resolves = (specifier: string): boolean =>
      insideGallery(resolveSpecifier(aliases, importer, specifier));
    const page = "gallery-page";
    expect(resolves(`${alias.prefix}${path.posix.relative(sourceDir, GALLERY_DIR)}/${page}`)).toBe(
      true,
    );
    expect(
      resolves(`${path.posix.relative(path.posix.dirname(importer), GALLERY_DIR)}/${page}`),
    ).toBe(true);
    expect(resolves(`${alias.prefix}router`)).toBe(false);
    expect(resolves("@repo/ui/components/button")).toBe(false);
  });
});
