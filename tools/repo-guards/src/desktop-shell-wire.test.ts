// The desktop shell is Rust, and the page and the CLI it runs are TypeScript, so the words they share
// cross no compiler: every command a page may ask, the capability that grants it, the event the
// updater pushes, the line the server announces itself on, the entry the shell runs and the content
// policy of any page the shell serves itself. Each is read as text from both sides here and held
// equal, so a rename on one side fails here rather than as a command no window can reach or a
// server the shell never hears.

import { buildContentSecurityPolicy } from "inteligir/server/csp";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonFile, sourceOf } from "./repo";

const CONTRACT = "apps/desktop/src/ipc-contract.ts";
const BUILD_SCRIPT = "apps/desktop/src-tauri/build.rs";
const COMMANDS = "apps/desktop/src-tauri/src/commands.rs";
const LIB = "apps/desktop/src-tauri/src/lib.rs";
const APP_CAPABILITY = "apps/desktop/src-tauri/capabilities/app-window.json";
const UPDATER = "apps/desktop/src-tauri/src/updater.rs";
const SERVER = "apps/desktop/src-tauri/src/server.rs";
const RUNTIME = "apps/desktop/src-tauri/src/runtime.rs";
const DESKTOP_SERVE = "apps/cli/src/desktop/desktop-serve.ts";
const CLI_BUILD = "apps/cli/scripts/build.mjs";
const TAURI_CONFIG = "apps/desktop/src-tauri/tauri.conf.json";
const CSP = "apps/cli/src/server/csp.ts";

// Tauri's own transport for commands, how a page the shell serves would reach them; IPC alone
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

// `name value; name value` as a map from each directive to its sources
const directives = (policy: string): Record<string, string> =>
  Object.fromEntries(
    policy.split("; ").map((entry) => {
      const space = entry.indexOf(" ");
      return [entry.slice(0, space), entry.slice(space + 1)];
    }),
  );

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

describe("the desktop shell's wire", () => {
  const appCommands = sorted(
    allMatches(block(CONTRACT, "export const APP_COMMANDS", "} as const;"), ROUTE),
  );

  it("names every command the page asks once, on both sides, and nothing else", () => {
    const manifest = sorted(allMatches(block(BUILD_SCRIPT, ".commands(&[", "])"), RUST_STRING));
    const handlers = sorted(
      allMatches(block(LIB, "generate_handler![", "]"), /commands::(?<name>[a-z_]+)/gu),
    );
    const asked = appCommands;
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

  it("grants the app window its commands, and nothing else", () => {
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

  it("holds a page the shell serves itself to the server's policy for a page with no socket", () => {
    const served = directives(buildContentSecurityPolicy({ wsOrigin: null }));
    const expected = {
      ...served,
      "connect-src": [served["connect-src"], ...TAURI_IPC_ORIGINS].join(" "),
    };
    const { csp } = readJsonFile(TAURI_CONFIG, tauriConfigSchema, "a Tauri config with a CSP").app
      .security;
    expect(
      csp,
      `${TAURI_CONFIG}'s CSP is not ${CSP}'s for a page with no socket.\n` +
        `  rule: a page the shell serves itself takes its policy from the shell's config, and it is the server's for a page with no socket plus Tauri's IPC origins, so neither loosens alone\n`,
    ).toEqual(expected);
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
