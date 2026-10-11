// The desktop shell is Rust, and the page and the CLI it runs are TypeScript, so the words they share
// cross no compiler: every command a page may ask, the capability that grants it, the event the
// updater pushes, the line the server announces itself on, the entry the shell runs, the first
// run's content policy, the env the shell pins on a child and the fields of every answer the CLI's
// desktop door gives. Each is read from both sides here and held equal, so a rename on one side
// fails here rather than as a command no window can reach or a server the shell never hears.

import fs from "node:fs";
import path from "node:path";
import {
  doorAnswerSchemas,
  openingAnswerSchema,
  planAnswerSchema,
  proposalAnswerSchema,
  targetAnswerSchema,
  warningAnswerSchema,
} from "inteligir/desktop/door-answers";
import { DATA_DIR_ENV_VAR, VAULT_DIR_ENV_VAR } from "inteligir/server/config";
import { buildContentSecurityPolicy } from "inteligir/server/csp";
import { UI_DEV_URL_ENV_VAR } from "inteligir/server/ui-dev-server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { policyDirectives } from "./content-security-policy";
import { readJsonFile, REPO_ROOT, sourceOf } from "./repo";

const CONTRACT = "apps/desktop/src/ipc-contract.ts";
const BUILD_SCRIPT = "apps/desktop/src-tauri/build.rs";
const COMMANDS = "apps/desktop/src-tauri/src/commands.rs";
const LIB = "apps/desktop/src-tauri/src/lib.rs";
const APP_CAPABILITY = "apps/desktop/src-tauri/capabilities/app-window.json";
const FIRST_RUN_CAPABILITY = "apps/desktop/src-tauri/capabilities/first-run.json";
const UPDATER = "apps/desktop/src-tauri/src/updater.rs";
const SERVER = "apps/desktop/src-tauri/src/server.rs";
const RUNTIME = "apps/desktop/src-tauri/src/runtime.rs";
const DESKTOP_SERVE = "apps/cli/src/desktop/desktop-serve.ts";
const CLI_BUILD = "apps/cli/scripts/build.ts";
const TAURI_CONFIG = "apps/desktop/src-tauri/tauri.conf.json";
const CSP = "apps/cli/src/server/csp.ts";
const SHELL = "apps/desktop/src-tauri/src/shell.rs";
const WINDOW = "apps/desktop/src-tauri/src/window.rs";
const LAUNCH = "apps/desktop/src-tauri/src/launch.rs";
const DOOR_ANSWERS = "apps/cli/src/desktop/__tests__/door-answers.ts";
const DOOR_FIXTURES = "apps/desktop/src-tauri/fixtures";

// Tauri's own transport for commands, how the first run reaches its four; it carries IPC alone
const TAURI_IPC_ORIGINS = ["ipc:", "http://ipc.localhost"];

// sorted, never deduplicated: a name two rows spell is the clash "once" refuses
const sorted = (names: Iterable<string>): string[] => [...names].toSorted();

const allMatches = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match.groups?.name ?? "");

// the text between a declaration's opening and the first line that closes it
const block = (file: string, opening: string, closing: string): string => {
  const source = sourceOf(file);
  const start = source.indexOf(opening);
  if (start === -1) {
    throw new Error(`${file} declares no ${opening}`);
  }
  const end = source.indexOf(closing, start);
  return source.slice(start, end === -1 ? undefined : end);
};

const ROUTE = /route\(\s*"(?<name>[a-z_]+)"/gu;
const RUST_STRING = /"(?<name>[a-z_]+)"/gu;
// a command's permission, as tauri-build names it: `allow-` and the name in kebab case
const PERMISSION = /^allow-(?<name>[a-z-]+)$/u;

const capabilitySchema = z.looseObject({ permissions: z.array(z.string()) });
const tauriConfigSchema = z.looseObject({
  app: z.looseObject({ security: z.looseObject({ csp: z.record(z.string(), z.string()) }) }),
});

const grantedBy = (file: string): string[] =>
  readJsonFile(file, capabilitySchema, "a capability with a permissions list").permissions.flatMap(
    (permission) => {
      const name = PERMISSION.exec(permission)?.groups?.name;
      return name === undefined ? [] : [name.replaceAll("-", "_")];
    },
  );

// a constant spelled as a string literal in a Rust file, `pub const NAME: &str = "…";`
const rustConstant = (file: string, name: string): string => {
  const value = new RegExp(`const ${name}: &str = "(?<value>[^"]*)";`, "u").exec(sourceOf(file))
    ?.groups?.value;
  if (value === undefined) {
    throw new Error(`${file} declares no ${name}`);
  }
  return value;
};

// serde's spelling of a Rust name under a container's `rename_all`, the only cases the door uses
const serdeName = (name: string, renameAll: string | undefined): string => {
  switch (renameAll) {
    case undefined: {
      return name;
    }
    case "camelCase": {
      return name.replaceAll(/_(?<letter>[a-z])/gu, (_match, letter: string) =>
        letter.toUpperCase(),
      );
    }
    case "kebab-case": {
      return name.replaceAll(/(?<=.)(?<upper>[A-Z])/gu, "-$<upper>").toLowerCase();
    }
    default: {
      throw new Error(`${LAUNCH}: this guard reads no rename_all = "${renameAll}"`);
    }
  }
};

const RUST_ITEM =
  /(?<attributes>(?:#\[[^\]]*\]\s*)*)pub (?<kind>struct|enum) (?<name>\w+) \{(?<body>[^}]*)\}/gu;
const RUST_FIELD = /^\s*pub (?<name>[a-z_][a-z0-9_]*):/gmu;
const RUST_VARIANT = /^\s*(?<name>[A-Z]\w*),?\s*$/gmu;
const RENAME_ALL = /rename_all = "(?<case>[^"]+)"/u;

// every struct's fields and every enum's variants as serde reads them off the wire, tests aside
const serdeMembers = (file: string): Map<string, string[]> => {
  const source = sourceOf(file);
  const tests = source.indexOf("#[cfg(test)]");
  const items = tests === -1 ? source : source.slice(0, tests);
  const read = new Map<string, string[]>();
  for (const match of items.matchAll(RUST_ITEM)) {
    const { attributes = "", body = "", kind, name = "" } = match.groups ?? {};
    if (body.includes("#[serde(")) {
      throw new Error(
        `${file}'s ${name} renames one of its own members, which this guard does not read`,
      );
    }
    const renameAll = RENAME_ALL.exec(attributes)?.groups?.case;
    const members = allMatches(body, kind === "enum" ? RUST_VARIANT : RUST_FIELD);
    read.set(
      name,
      members.map((member) => serdeName(member, renameAll)),
    );
  }
  return read;
};

// what each serde type in launch.rs reads, as the door test's schemas spell it
const DOOR_ANSWER_FIELDS = new Map<string, readonly string[]>([
  ["FolderSync", Object.keys(doorAnswerSchemas.sync.shape)],
  ["Handoff", Object.keys(doorAnswerSchemas.handoff.shape)],
  ["Launch", Object.keys(doorAnswerSchemas.launch.shape)],
  ["Opening", Object.keys(openingAnswerSchema.shape)],
  ["Plan", planAnswerSchema.options],
  ["Proposal", Object.keys(proposalAnswerSchema.shape)],
  ["Target", Object.keys(targetAnswerSchema.shape)],
  ["Warning", Object.keys(warningAnswerSchema.shape)],
]);

const isDoorVerb = (name: string): name is keyof typeof doorAnswerSchemas =>
  Object.hasOwn(doorAnswerSchemas, name);

describe("the desktop shell's wire", () => {
  const appCommands = sorted(
    allMatches(block(CONTRACT, "export const APP_COMMANDS", "} as const;"), ROUTE),
  );
  const firstRunCommands = sorted(
    allMatches(block(CONTRACT, "export const FIRST_RUN_COMMANDS", "} as const;"), ROUTE),
  );

  it("names every command the page asks once, on both sides, and nothing else", () => {
    const manifest = sorted(allMatches(block(BUILD_SCRIPT, ".commands(&[", "])"), RUST_STRING));
    const handlers = sorted(
      allMatches(block(LIB, "generate_handler![", "]"), /commands::(?<name>[a-z_]+)/gu),
    );
    const asked = sorted([...appCommands, ...firstRunCommands]);
    expect(
      manifest,
      `${BUILD_SCRIPT}'s app manifest and ${CONTRACT}'s rows disagree.\n` +
        `  rule: a command the page asks must be one the manifest names (else no capability can grant it), and one the manifest names must be one a page asks\n`,
    ).toEqual(asked);
    expect(
      handlers,
      `${LIB}'s generate_handler! and ${CONTRACT}'s rows disagree.\n` +
        `  rule: every command a page asks has a handler, and no handler goes unasked\n`,
    ).toEqual(asked);
  });

  it("grants the app window its commands and the first run its own, and neither the other's", () => {
    const appWindow = sorted(
      allMatches(block(COMMANDS, "pub const APP_WINDOW_COMMANDS", "];"), RUST_STRING),
    );
    expect(
      appWindow,
      `${COMMANDS}'s APP_WINDOW_COMMANDS, which the shell grants the app window at runtime, and ${CONTRACT}'s APP_COMMANDS disagree\n`,
    ).toEqual(appCommands);
    expect(
      sorted(grantedBy(APP_CAPABILITY)),
      `${APP_CAPABILITY} keeps the app window's commands in the build, and must list exactly APP_COMMANDS\n`,
    ).toEqual(appCommands);
    expect(
      sorted(grantedBy(FIRST_RUN_CAPABILITY)),
      `${FIRST_RUN_CAPABILITY} must grant exactly FIRST_RUN_COMMANDS: the first run has no server, so it asks for nothing else\n`,
    ).toEqual(firstRunCommands);
  });

  it("pushes the update state under the event the page hears", () => {
    const heard = /event: "(?<name>[^"]+)"/u.exec(
      block(CONTRACT, "export const UPDATE_STATE_EVENT", "};"),
    )?.groups?.name;
    expect(heard, `${CONTRACT}'s UPDATE_STATE_EVENT and ${UPDATER}'s disagree\n`).toBe(
      rustConstant(UPDATER, "UPDATE_STATE_EVENT"),
    );
  });

  it("reads the server's announcement under the marker the CLI prints", () => {
    const printed = /const READY_MARKER = "(?<value>[^"]+)";/u.exec(sourceOf(DESKTOP_SERVE))?.groups
      ?.value;
    expect(printed, `${DESKTOP_SERVE}'s READY_MARKER and ${SERVER}'s disagree\n`).toBe(
      rustConstant(SERVER, "READY_MARKER"),
    );
  });

  it("holds the first run to the server's policy for a page with no socket", () => {
    const served = policyDirectives(buildContentSecurityPolicy({ wsOrigin: null }));
    const expected = {
      ...served,
      "connect-src": [served["connect-src"], ...TAURI_IPC_ORIGINS].join(" "),
    };
    const { csp } = readJsonFile(TAURI_CONFIG, tauriConfigSchema, "a Tauri config with a CSP").app
      .security;
    expect(
      csp,
      `${TAURI_CONFIG}'s CSP is not ${CSP}'s for a page with no socket.\n` +
        `  rule: the first run is the shell's own page, so its policy lives in the shell's config, and it is the server's for a page with no socket plus Tauri's IPC origins, so neither loosens alone\n`,
    ).toEqual(expected);
  });

  it("pins a child's env under the names the CLI reads", () => {
    const pinned: [string, string][] = [
      ["DATA_DIR_ENV_VAR", DATA_DIR_ENV_VAR],
      ["VAULT_DIR_ENV_VAR", VAULT_DIR_ENV_VAR],
      ["UI_DEV_URL_ENV_VAR", UI_DEV_URL_ENV_VAR],
    ];
    for (const [name, read] of pinned) {
      expect(rustConstant(SHELL, name), `${SHELL}'s ${name} is not the CLI's\n`).toBe(read);
    }
    const literals = sourceOf(SHELL)
      .split("\n")
      .filter((line) => line.includes('"INTELIGIR_') && !/^const \w+: &str = /u.test(line));
    expect(
      literals,
      `${SHELL} spells an INTELIGIR_ name outside its constants.\n` +
        `  rule: every name the shell sets is a constant held to the CLI's own here\n`,
    ).toEqual([]);
  });

  it("grants the app window the core permissions its capability keeps", () => {
    const granted = sorted(
      allMatches(
        block(WINDOW, "const APP_WINDOW_CORE_PERMISSIONS", "];"),
        /"(?<name>core:[a-z:-]+)"/gu,
      ),
    );
    const kept = sorted(
      readJsonFile(
        APP_CAPABILITY,
        capabilitySchema,
        "a capability with a permissions list",
      ).permissions.filter((permission) => permission.startsWith("core:")),
    );
    expect(
      granted,
      `${WINDOW}'s APP_WINDOW_CORE_PERMISSIONS, which the shell grants at runtime, and ${APP_CAPABILITY}'s core permissions, which the build keeps, disagree\n`,
    ).toEqual(kept);
  });

  it("reads every door answer by the fields the CLI writes", () => {
    const read = serdeMembers(LAUNCH);
    expect(
      sorted(read.keys()),
      `${LAUNCH}'s types and ${DOOR_ANSWERS}'s rows disagree.\n` +
        `  rule: every type the shell reads a door answer into is held to the schema of what the CLI answers\n`,
    ).toEqual(sorted(DOOR_ANSWER_FIELDS.keys()));
    for (const [name, fields] of read) {
      expect(
        sorted(fields),
        `${LAUNCH}'s ${name} and its schema in ${DOOR_ANSWERS} name different fields\n`,
      ).toEqual(sorted(DOOR_ANSWER_FIELDS.get(name) ?? []));
    }
  });

  it("parses the fixtures the shell's tests read as the answers the CLI gives", () => {
    const fixtures = fs
      .readdirSync(path.join(REPO_ROOT, DOOR_FIXTURES))
      .filter((file) => file.endsWith(".json"));
    expect(fixtures, `${DOOR_FIXTURES} holds no fixture`).not.toEqual([]);
    for (const file of fixtures) {
      const verb = path.basename(file, ".json");
      expect(isDoorVerb(verb), `${DOOR_FIXTURES}/${file} is named for no door question`).toBe(true);
      if (isDoorVerb(verb)) {
        const schema: z.ZodType = doorAnswerSchemas[verb];
        readJsonFile(`${DOOR_FIXTURES}/${file}`, schema, `the door's answer to ${verb}`);
      }
    }
  });

  it("runs the entry the CLI's build writes", () => {
    const entry = /(?<name>\w+): "src\/desktop\/desktop-entry\.ts"/u.exec(sourceOf(CLI_BUILD))
      ?.groups?.name;
    expect(entry, `${CLI_BUILD} builds no src/desktop/desktop-entry.ts`).toBeDefined();
    expect(
      `dist/${entry ?? ""}.js`,
      `${RUNTIME}'s DESKTOP_ENTRY is not the file ${CLI_BUILD} writes\n`,
    ).toBe(rustConstant(RUNTIME, "DESKTOP_ENTRY"));
  });
});
