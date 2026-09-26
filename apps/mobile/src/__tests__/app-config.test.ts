// the config and the linked modules are read from expo's own CLIs, never re-derived here, so what
// is held is what prebuild would write into the binary App Store Connect judges.

import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import plist from "@expo/plist";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const APP_ROOT = path.resolve(import.meta.dirname, "../..");
const EXPO_BIN_DIR = path.join(APP_ROOT, "node_modules", "expo", "bin");
const PRIVACY_MANIFEST = /\.xcprivacy$/u;
const USAGE_DESCRIPTION = /^NS\w*UsageDescription$/u;
// what an Expo config plugin writes when the app states no purpose of its own.
const EXPO_DEFAULT_PURPOSE = "Allow $(PRODUCT_NAME)";
// three node processes on a loaded runner, the config one evaluating every plugin.
const SPAWN_BUDGET_MS = 120_000;

const runFile = promisify(execFile);

const accessedApiSchema = z.object({
  NSPrivacyAccessedAPIType: z.string(),
  NSPrivacyAccessedAPITypeReasons: z.array(z.string()),
});

const privacyManifestSchema = z.looseObject({
  NSPrivacyAccessedAPITypes: z.array(accessedApiSchema).optional(),
});

const appConfigSchema = z.looseObject({
  ios: z.looseObject({
    infoPlist: z.record(z.string(), z.unknown()),
    privacyManifests: privacyManifestSchema.optional(),
  }),
});
type AppConfig = z.infer<typeof appConfigSchema>;

const expoModulesSchema = z.looseObject({
  modules: z.array(
    z.looseObject({
      packageName: z.string(),
      pods: z.array(z.looseObject({ podspecDir: z.string() })),
    }),
  ),
});

const communityModulesSchema = z.looseObject({
  dependencies: z.record(
    z.string(),
    z.looseObject({
      platforms: z.looseObject({
        ios: z.looseObject({ podspecPath: z.string() }).nullish(),
      }),
    }),
  ),
});

const packageVersionSchema = z.looseObject({ version: z.string() });

const purposeSchema = z.string();

interface LinkedPod {
  packageName: string;
  dir: string;
}

interface DeclaredReason {
  packageName: string;
  file: string;
  api: string;
  reason: string;
}

const readCli = async <T>(script: string, args: string[], schema: z.ZodType<T>): Promise<T> => {
  const { stdout } = await runFile(process.execPath, [path.join(EXPO_BIN_DIR, script), ...args], {
    cwd: APP_ROOT,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return schema.parse(JSON.parse(stdout));
};

const linkedPods = async (): Promise<LinkedPod[]> => {
  const expoModules = await readCli(
    "autolinking",
    ["resolve", "-p", "apple", "--json"],
    expoModulesSchema,
  );
  const community = await readCli(
    "autolinking",
    ["react-native-config", "-p", "ios", "--json"],
    communityModulesSchema,
  );
  const pods: LinkedPod[] = expoModules.modules.flatMap((module) =>
    module.pods.map((pod) => ({ dir: pod.podspecDir, packageName: module.packageName })),
  );
  for (const [packageName, dependency] of Object.entries(community.dependencies)) {
    const { ios } = dependency.platforms;
    if (ios !== null && ios !== undefined) {
      pods.push({ dir: path.dirname(ios.podspecPath), packageName });
    }
  }
  return pods;
};

// a module's manifest ships beside its podspec or below it; a nested node_modules is another
// package's.
const privacyManifestsUnder = async (dir: string): Promise<string[]> => {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      found.push(...(await privacyManifestsUnder(full)));
    } else if (entry.isFile() && PRIVACY_MANIFEST.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const declaredReasons = async (pods: LinkedPod[]): Promise<DeclaredReason[]> => {
  const reasons: DeclaredReason[] = [];
  const read = new Set<string>();
  for (const pod of pods) {
    for (const file of await privacyManifestsUnder(pod.dir)) {
      if (read.has(file)) {
        continue;
      }
      read.add(file);
      const manifest = privacyManifestSchema.parse(plist.parse(await readFile(file, "utf-8")));
      for (const api of manifest.NSPrivacyAccessedAPITypes ?? []) {
        for (const reason of api.NSPrivacyAccessedAPITypeReasons) {
          reasons.push({
            api: api.NSPrivacyAccessedAPIType,
            file: path.relative(pod.dir, file),
            packageName: pod.packageName,
            reason,
          });
        }
      }
    }
  }
  return reasons;
};

const reasonKey = (api: string, reason: string): string => `${api} ${reason}`;

describe("the phone's store config", () => {
  let config: AppConfig;
  let packageVersion: string;
  let moduleReasons: DeclaredReason[];

  beforeAll(async () => {
    const [introspected, pods, manifest] = await Promise.all([
      readCli("cli", ["config", "--type", "introspect", "--json"], appConfigSchema),
      linkedPods(),
      readFile(path.join(APP_ROOT, "package.json"), "utf-8"),
    ]);
    config = introspected;
    packageVersion = packageVersionSchema.parse(JSON.parse(manifest)).version;
    moduleReasons = await declaredReasons(pods);
  }, SPAWN_BUDGET_MS);

  it("ships the package's version as the marketing version", () => {
    expect(
      config.ios.infoPlist.CFBundleShortVersionString,
      "rule: CFBundleShortVersionString is apps/mobile/package.json's version, the product version tools/repo-guards/src/release-versions.test.ts holds across apps\n" +
        "fix: app.config.js passes the package's version through; change it in package.json, never there",
    ).toBe(packageVersion);
  });

  it("declares its encryption exempt, so no build waits on export compliance", () => {
    expect(
      config.ios.infoPlist.ITSAppUsesNonExemptEncryption,
      "rule: the app uses only the system's HTTPS and Keychain, which App Store Connect exempts; unanswered, every TestFlight build waits on the question\n" +
        "fix: ios.config.usesNonExemptEncryption: false in app.config.js",
    ).toBe(false);
  });

  it("states its own purpose for every permission it asks", () => {
    const defaults = Object.entries(config.ios.infoPlist)
      .filter(([key]) => USAGE_DESCRIPTION.test(key))
      .map(([key, value]) => ({ key, purpose: purposeSchema.safeParse(value) }))
      .filter(({ purpose }) => !purpose.success || purpose.data.startsWith(EXPO_DEFAULT_PURPOSE))
      .map(({ key, purpose }) => `${key}: ${purpose.success ? purpose.data : "not a sentence"}`);
    expect(
      defaults,
      "rule: a purpose string is what the permission prompt shows, and an Expo plugin's default names no reason the user could weigh\n" +
        "fix: pass the plugin the app's own sentence, or false where the app never asks",
    ).toEqual([]);
  });

  it("finds the manifests it holds the config to", () => {
    expect(
      moduleReasons.map((row) => row.packageName),
      "expo-file-system ships a privacy manifest; the sweep is broken, not the tree",
    ).toContain("expo-file-system");
  });

  it("declares every required-reason API a linked module declares", () => {
    const declared = new Set(
      (config.ios.privacyManifests?.NSPrivacyAccessedAPITypes ?? []).flatMap((api) =>
        api.NSPrivacyAccessedAPITypeReasons.map((reason) =>
          reasonKey(api.NSPrivacyAccessedAPIType, reason),
        ),
      ),
    );
    const missing = moduleReasons
      .filter((row) => !declared.has(reasonKey(row.api, row.reason)))
      .map((row) => `${row.packageName} (${row.file}): ${row.api} ${row.reason}`);
    expect(
      [...new Set(missing)],
      "rule: Apple does not reliably read a static pod's own privacy manifest, so the app's must declare every reason a linked module does, or the upload is refused (ITMS-91053)\n" +
        "fix: add the reason under ios.privacyManifests.NSPrivacyAccessedAPITypes in app.config.js",
    ).toEqual([]);
  });
});
