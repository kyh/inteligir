// one product version across every artifact a release ships, and EAS builds the phone with the
// toolchain this repo is checked with. apps/web is not a release artifact: the Worker deploys on
// every push to main.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { REPO_ROOT, WORKSPACE_MANIFEST } from "./repo";

const ROOT_MANIFEST = "package.json";
const EAS_CONFIG = "apps/mobile/eas.json";
const RELEASED_MANIFESTS = [
  "apps/cli/package.json",
  "apps/desktop/package.json",
  "apps/mobile/package.json",
];
const EAS_CLI = "eas-cli";

const EXACT_VERSION = /^(?<major>\d+)\.\d+\.\d+$/u;
const MAJOR_RANGE = /^(?<major>\d+)\.x$/u;

const readJsonFile = <T>(relativePath: string, schema: z.ZodType<T>, expected: string): T => {
  const parsed = schema.safeParse(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")),
  );
  if (!parsed.success) {
    throw new Error(`${relativePath}: expected ${expected}`);
  }
  return parsed.data;
};

const rootManifestSchema = z.looseObject({
  engines: z.looseObject({ node: z.string() }),
  packageManager: z.string(),
});

const versionedManifestSchema = z.looseObject({ version: z.string() });

const easConfigSchema = z.looseObject({
  build: z.record(z.string(), z.looseObject({ node: z.string(), pnpm: z.string() })),
  cli: z.looseObject({ version: z.string() }),
});

const catalogSchema = z.looseObject({ catalog: z.record(z.string(), z.string()) });

const rootManifest = () =>
  readJsonFile(ROOT_MANIFEST, rootManifestSchema, 'a string "engines.node" and "packageManager"');

const easConfig = () =>
  readJsonFile(
    EAS_CONFIG,
    easConfigSchema,
    'a "cli.version" and a "node" and "pnpm" version on every build profile',
  );

const catalog = (): Record<string, string> => {
  const parsed = catalogSchema.safeParse(
    parseYaml(fs.readFileSync(path.join(REPO_ROOT, WORKSPACE_MANIFEST), "utf-8")),
  );
  if (!parsed.success) {
    throw new Error(`${WORKSPACE_MANIFEST}: expected a "catalog" of string versions`);
  }
  return parsed.data.catalog;
};

const pinnedPnpm = (): string => {
  const { packageManager } = rootManifest();
  const [name, version] = packageManager.split("@");
  if (name !== "pnpm" || version === undefined || !EXACT_VERSION.test(version)) {
    throw new Error(
      `${ROOT_MANIFEST}: "packageManager" must be "pnpm@<major.minor.patch>" (got "${packageManager}")`,
    );
  }
  return version;
};

// only the `<major>.x` spelling is judged: a general range grammar here would be a second semver
// implementation to trust.
const engineMajor = (): string => {
  const { engines } = rootManifest();
  const major = MAJOR_RANGE.exec(engines.node)?.groups?.major;
  if (major === undefined) {
    throw new Error(
      `${ROOT_MANIFEST}: "engines.node" must be spelled "<major>.x" for this guard to hold EAS to it (got "${engines.node}")`,
    );
  }
  return major;
};

describe("release versions", () => {
  it("every released artifact ships one product version", () => {
    const versions = RELEASED_MANIFESTS.map((manifest) => ({
      manifest,
      version: readJsonFile(manifest, versionedManifestSchema, 'a string "version"').version,
    }));
    const spelled = new Set(versions.map((row) => row.version));
    expect(
      spelled.size,
      `\nSPLIT PRODUCT VERSION\n${versions.map((row) => `  ${row.manifest}  ${row.version}`).join("\n")}\n` +
        `  rule: the CLI, the desktop app and the phone are one release, and the phone's marketing version is its package's\n` +
        `  fix: give all three the version being released\n`,
    ).toBe(1);
  });
});

describe("the phone's EAS build", () => {
  it("installs with the pnpm the repo pins", () => {
    const pnpm = pinnedPnpm();
    const violations = Object.entries(easConfig().build)
      .filter(([, profile]) => profile.pnpm !== pnpm)
      .map(
        ([name, profile]) =>
          `${EAS_CONFIG} build.${name}.pnpm is ${profile.pnpm}, ${ROOT_MANIFEST} "packageManager" pins ${pnpm}`,
      );
    expect(
      violations,
      `\n${violations.join("\n")}\n  rule: a lockfile is only frozen for the pnpm that wrote it\n  fix: set the profile's "pnpm" to ${pnpm}\n`,
    ).toEqual([]);
  });

  it("runs on the node major the repo's engines name", () => {
    const major = engineMajor();
    const violations = Object.entries(easConfig().build)
      .filter(([, profile]) => EXACT_VERSION.exec(profile.node)?.groups?.major !== major)
      .map(
        ([name, profile]) =>
          `${EAS_CONFIG} build.${name}.node is "${profile.node}", outside ${ROOT_MANIFEST} "engines.node"`,
      );
    expect(
      violations,
      `\n${violations.join("\n")}\n  rule: EAS takes an exact version, and it must be one the repo is checked on\n  fix: an exact ${major}.<minor>.<patch>\n`,
    ).toEqual([]);
  });

  it("floors the eas-cli version at the one the catalog pins", () => {
    const pinned = catalog()[EAS_CLI];
    expect(
      pinned === undefined ? undefined : EXACT_VERSION.test(pinned),
      `${WORKSPACE_MANIFEST}: catalog "${EAS_CLI}" must be an exact version, since ${EAS_CONFIG} floors at it`,
    ).toBe(true);
    expect(
      easConfig().cli.version,
      `rule: ${EAS_CONFIG} cli.version names the eas-cli the repo installs, so a build never runs under an older one\n  fix: "cli.version": ">= ${String(pinned)}"`,
    ).toBe(`>= ${String(pinned)}`);
  });
});
