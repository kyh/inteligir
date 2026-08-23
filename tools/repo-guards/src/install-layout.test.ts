// ---------------------------------------------------------------------------
// The staged install layout, held against every encoder of it.
//
// `dist/apps/{app,cli}` is not a build detail. It is a contract between the
// build that writes it, the launcher entry that imports the staged app, the
// app's own entry resolver, the agent's PATH resolver, the shell's server
// path, the published `bin` map and two smokes — none of which import each
// other, and until now none of which agreed by construction. Flattening the
// directory removes `inteligir` from the agent's PATH with NO ERROR ANYWHERE:
// nothing throws, nothing logs, and a model simply stops being able to drive
// the product.
//
// `apps/launcher/scripts/staged-layout.mjs` now owns it, and the three `.mjs`
// callers — the build and both smokes — import it. This guard holds the rest
// against it: every string below is COMPUTED from that module, so changing the
// layout there and forgetting an encoder fails here, naming both.
//
// Why the remaining encoders are textual rather than importers: `apps/app` may
// not depend on the package that packages it (a cycle, and the dep DAG refuses
// it), and the shell would be bundling a build-time module into its main
// process. A textual check is what is available, so what it checks is a
// SEGMENT SEQUENCE — the quoted path pieces in order, with any whitespace
// between — which survives formatting and catches a reordered or renamed one.
//
// This guard reads `scripts/`, `package.json` and a YAML config, all of which
// `repo.ts`'s `src/**` walk cannot see. That is deliberate and it is why these
// couplings had no guard: the blind spot is not that nobody looked, it is that
// every existing guard was structurally unable to.
//
// The layout module is imported by PATH rather than as `inteligir/…`, the same
// way every other guard here reaches across workspaces. A package specifier
// would make this a workspace dependency of the guards, which is a
// relationship the DAG would then have to carry for a fitness test.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import {
  APP_BUNDLE_DIR,
  APP_DIR,
  APPS_DIR,
  APP_SERVER_ENTRY,
  CLI_BIN_DIR,
  CLI_BIN_NAME,
  CLI_DIR,
  DIST_DIR,
  RUNTIME_PACKAGE,
  SKILLS_DIR,
  appServerEntryFromDist,
  publishedBinMap,
} from "../../../apps/launcher/scripts/staged-layout.mjs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REPO_ROOT, sourceOf } from "./repo";

/** The module every encoder below is measured against. */
const LAYOUT = "apps/launcher/scripts/staged-layout.mjs";
const LAUNCHER_MANIFEST = "apps/launcher/package.json";
const ELECTRON_BUILDER = "apps/desktop/electron-builder.yml";

/** The `.mjs` callers that must IMPORT the layout rather than restate it. Each
 *  one used to spell the tree out for itself; the desktop smoke was a fourth
 *  independent spelling that never called the shell's own resolver either. */
const IMPORTERS = new Map<string, string>([
  [
    "apps/launcher/scripts/build.mjs",
    "the producer — it writes the tree every other encoder walks",
  ],
  [
    "apps/launcher/scripts/smoke.mjs",
    "proves a real npm install has the tree at the paths it claims",
  ],
  [
    "apps/desktop/scripts/smoke-packaged.mjs",
    "proves the packed .app carries the same tree inside app.asar.unpacked",
  ],
]);

interface Encoder {
  file: string;
  /** What this file has to get right, as the failure says it. */
  encodes: string;
  /** Why it cannot simply import the layout module. */
  why: string;
  /** Path pieces it must name in order — computed from the layout module. */
  segments: string[];
  /** Literals it must name somewhere, for facts that are not a path walk. */
  names?: string[];
}

/**
 * The encoders that cannot import. Every `segments` array is built from the
 * layout module's own exports, so nothing here is a copy of the layout — it is
 * the layout, asked of a file that spells it by hand.
 */
const ENCODERS: Encoder[] = [
  {
    file: "apps/launcher/src/main.ts",
    encodes: "the staged app entry it imports, relative to its own bundle",
    why: "it IS the bundle esbuild writes into dist/, so it resolves the entry as a URL beside itself",
    segments: appServerEntryFromDist().split("/"),
  },
  {
    file: "apps/app/src/node/agent/agent-shell-env.ts",
    encodes:
      "the walk from the running app bundle up to the CLI's bin, which is what puts `inteligir` on the agent's PATH",
    why: "apps/app may not depend on the package that packages it",
    segments: ["..", "..", CLI_DIR, CLI_BIN_DIR],
  },
  {
    file: "apps/app/src/node/agent/agent-shell-env.ts",
    encodes: "the packaged product skills staged beside the app bundle",
    why: "apps/app may not depend on the package that packages it",
    segments: ["..", SKILLS_DIR],
  },
  {
    file: "apps/desktop/src/main/server-paths.ts",
    encodes: "the server entry inside an installed (or asar-unpacked) tree",
    why: "it is shipped main-process code; importing a build script would bundle it into the shell",
    segments: [DIST_DIR, APPS_DIR, APP_DIR, APP_BUNDLE_DIR, APP_SERVER_ENTRY],
    // The package name is a const at the top of that file, far from the walk,
    // so it is asked for separately rather than by widening the gap between
    // segments until the order stops meaning anything.
    names: [RUNTIME_PACKAGE],
  },
];

/** `"a"`, `"b"`, `"c"` in order, however the formatter broke the lines. */
function segmentSequence(segments: readonly string[]): RegExp {
  return new RegExp(
    segments
      .map((segment) => `["'\`]${segment.replaceAll(".", "\\.")}["'\`]`)
      .join("[\\s\\S]{0,40}?"),
  );
}

/** …or as one joined literal, which is how a URL-resolved path is spelled. */
function joinedLiteral(segments: readonly string[]): RegExp {
  return new RegExp(segments.map((segment) => segment.replaceAll(".", "\\.")).join("[/\\\\]"));
}

/** The one field of the launcher manifest this guard reads. */
const binMapSchema = z.looseObject({ bin: z.record(z.string(), z.string()) });

describe("the staged install layout", () => {
  it("has a layout module, and it is the one every importer names", () => {
    // A module nobody imports is a fourth spelling with extra steps, so the
    // importers are checked before anything is measured against it.
    expect(fs.existsSync(path.join(REPO_ROOT, LAYOUT)), `${LAYOUT} is missing`).toBe(true);
    const violations: string[] = [];
    for (const [file, role] of IMPORTERS) {
      if (!fs.existsSync(path.join(REPO_ROOT, file))) {
        violations.push(
          `MISSING IMPORTER  ${file}\n  it was ${role}\n  fix: update IMPORTERS, or restore the file`,
        );
        continue;
      }
      if (sourceOf(file).includes("staged-layout.mjs")) continue;
      violations.push(
        `RESTATED LAYOUT  ${file}\n` +
          `  role: ${role}\n` +
          `  rule: a caller that can import ${LAYOUT} imports it — this one spells the tree out for itself again, which is how the desktop smoke ended up asserting a path the build had stopped writing\n` +
          `  fix: import the paths from ${LAYOUT}`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("the published bin map IS the layout's", () => {
    // Real equality rather than a text match: npm strips the execute bit from
    // every packed file it does not name here, and the agent's resolver
    // refuses a file without one — so a bin entry that drifts from the staged
    // path removes the CLI from the agent's PATH on a published install only.
    const parsed = binMapSchema.safeParse(JSON.parse(sourceOf(LAUNCHER_MANIFEST)));
    const declared = parsed.success ? parsed.data.bin : null;
    expect(
      declared,
      `${LAUNCHER_MANIFEST} declares no "bin" map; ${LAYOUT} says it must be ${JSON.stringify(publishedBinMap())}`,
    ).not.toBeNull();
    expect(
      declared,
      `${LAUNCHER_MANIFEST}'s "bin" map disagrees with ${LAYOUT}.\n` +
        `  rule: the bin map names files inside the staged tree, and npm keeps the execute bit only on the files it names\n` +
        `  fix: make them agree — the layout module is the source`,
    ).toEqual(publishedBinMap());
  });

  it("every encoder that cannot import still spells the same tree", () => {
    const violations: string[] = [];
    for (const encoder of ENCODERS) {
      if (!fs.existsSync(path.join(REPO_ROOT, encoder.file))) {
        violations.push(
          `MISSING ENCODER  ${encoder.file}\n` +
            `  it encoded: ${encoder.encodes}\n` +
            `  fix: update ENCODERS, or restore the file`,
        );
        continue;
      }
      const source = sourceOf(encoder.file);
      for (const name of encoder.names ?? []) {
        if (new RegExp(`["'\`]${name}["'\`]`).test(source)) continue;
        violations.push(
          `LAYOUT DRIFT  ${encoder.file}\n` +
            `  encodes: ${encoder.encodes}\n` +
            `  it never names "${name}", which ${LAYOUT} says this tree is rooted at\n` +
            `  fix: change this file to match ${LAYOUT}, or change the layout module and this row together`,
        );
      }
      if (segmentSequence(encoder.segments).test(source)) continue;
      if (joinedLiteral(encoder.segments).test(source)) continue;
      violations.push(
        `LAYOUT DRIFT  ${encoder.file}\n` +
          `  encodes: ${encoder.encodes}\n` +
          `  expected the path pieces ${encoder.segments.map((segment) => `"${segment}"`).join(" ")} in that order, and found neither them nor a joined spelling of them\n` +
          `  rule: this file cannot import ${LAYOUT} (${encoder.why}), so it is held against it here — a tree that agrees in five places and not the sixth fails with no error at runtime\n` +
          `  fix: change this file to match ${LAYOUT}, or change the layout module and this row together`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("the packaged shell unpacks the tree it spawns from", () => {
    // An asar is not a filesystem a child process can be spawned from, so the
    // staged bundle has to be unpacked beside it. Without this the shell's
    // path resolves correctly to a file that cannot be executed — the layout
    // being right and still not working.
    const config = fs.readFileSync(path.join(REPO_ROOT, ELECTRON_BUILDER), "utf8");
    expect(
      /asarUnpack:[\s\S]*?node_modules/.test(config),
      `${ELECTRON_BUILDER} does not unpack node_modules.\n` +
        `  rule: the shell spawns ${RUNTIME_PACKAGE}'s staged bundle as a child process, and a path inside app.asar is not one a child can run\n` +
        `  fix: keep "node_modules/**" in asarUnpack`,
    ).toBe(true);
  });

  it("reads a real layout, not an empty one", () => {
    // Every expectation above is built from these; an empty or renamed export
    // would make the segment sequences trivially satisfiable.
    expect(appServerEntryFromDist()).toBe(
      [APPS_DIR, APP_DIR, APP_BUNDLE_DIR, APP_SERVER_ENTRY].join("/"),
    );
    expect(Object.keys(publishedBinMap())).toEqual([RUNTIME_PACKAGE, `${RUNTIME_PACKAGE}-cli`]);
    expect(CLI_BIN_NAME.length).toBeGreaterThan(0);
  });
});
