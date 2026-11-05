// The desktop shell is Rust and the page it carries is TypeScript, so the words they share cross no
// compiler: every command the page may ask, the capability that grants it, the event the updater
// pushes, the error kinds a command rejects with, the origins the page runs on and calls, the
// scheme its files ride, the window's content policy, the bundle id the browser's door opens the
// app by and the debug build's own. Each is read from both sides here and held equal, so a rename on one side fails here
// rather than as a command no page can reach or a call the policy refuses.

import { MAC_APP_ORIGIN, PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonFile, sourceOf } from "./repo";

const CONTRACT = "apps/workspace/src/shell/ipc-contract.ts";
const SHELL_ERROR = "apps/workspace/src/shell/shell-error.ts";
const BUILD_SCRIPT = "apps/desktop/src-tauri/build.rs";
const LIB = "apps/desktop/src-tauri/src/lib.rs";
const CAPABILITY = "apps/desktop/src-tauri/capabilities/app-window.json";
const UPDATER = "apps/desktop/src-tauri/src/updater.rs";
const ERROR = "apps/desktop/src-tauri/src/error.rs";
const CLOUD = "apps/desktop/src-tauri/src/cloud.rs";
const WINDOW = "apps/desktop/src-tauri/src/window.rs";
const FILE_SCHEME = "apps/desktop/src-tauri/src/file_scheme.rs";
const APP_IDENTITY = "apps/cli/src/desktop/app-identity.ts";
const TAURI_CONFIG = "apps/desktop/src-tauri/tauri.conf.json";
const LOCAL_CONFIG = "apps/desktop/src-tauri/tauri.local.conf.json";
const ISOLATION_PAGE = "apps/desktop/isolation/index.html";

// Tauri's own transport for commands; it carries IPC alone
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

const ROUTE = /(?:route|bytesRoute)\(\s*"(?<name>[a-z_]+)"/gu;
const RUST_STRING = /"(?<name>[a-z_]+)"/gu;
// a command's permission, as tauri-build names it: `allow-` and the name in kebab case
const PERMISSION = /^allow-(?<name>[a-z-]+)$/u;

const capabilitySchema = z.looseObject({
  local: z.boolean(),
  permissions: z.array(z.string()),
  remote: z.unknown().optional(),
  windows: z.array(z.string()),
});
const cspSchema = z.record(z.string(), z.string());
const tauriConfigSchema = z.looseObject({
  app: z.looseObject({
    security: z.looseObject({
      csp: cspSchema,
      pattern: z.object({ options: z.object({ dir: z.string() }), use: z.literal("isolation") }),
    }),
  }),
  identifier: z.string(),
});
const localConfigSchema = z.looseObject({
  app: z.looseObject({ security: z.looseObject({ csp: cspSchema }) }),
  identifier: z.string(),
});

// a constant spelled as a string literal in a Rust file, `const NAME: &str = "…";`
const rustConstant = (file: string, name: string): string => {
  const value = new RegExp(`const ${name}: &str = "(?<value>[^"]*)";`, "u").exec(sourceOf(file))
    ?.groups?.value;
  if (value === undefined) {
    throw new Error(`${file} declares no ${name}`);
  }
  return value;
};

const sources = (policy: Record<string, string>, directive: string): string[] =>
  (policy[directive] ?? "").split(" ").filter((source) => source !== "");

const tauriConfig = () => readJsonFile(TAURI_CONFIG, tauriConfigSchema, "a Tauri config");
const localConfig = () => readJsonFile(LOCAL_CONFIG, localConfigSchema, "a local Tauri config");

describe("the desktop shell's wire", () => {
  const appCommands = sorted(
    allMatches(block(CONTRACT, "export const APP_COMMANDS", "} as const;"), ROUTE),
  );

  it("names every command the page asks once, on both sides, and nothing else", () => {
    const manifest = sorted(allMatches(block(BUILD_SCRIPT, ".commands(&[", "])"), RUST_STRING));
    const handlers = sorted(
      allMatches(block(LIB, "generate_handler![", "]"), /commands::(?<name>[a-z_]+)/gu),
    );
    expect(
      manifest,
      `${BUILD_SCRIPT}'s app manifest and ${CONTRACT}'s rows disagree.\n` +
        `  rule: a command the page asks must be one the manifest names (else no capability can grant it), and one the manifest names must be one the page asks\n`,
    ).toEqual(appCommands);
    expect(
      handlers,
      `${LIB}'s generate_handler! and ${CONTRACT}'s rows disagree.\n` +
        `  rule: every command the page asks has a handler, and no handler goes unasked\n`,
    ).toEqual(appCommands);
  });

  it("grants the window's own page its commands, and no remote page any", () => {
    const capability = readJsonFile(CAPABILITY, capabilitySchema, "a capability");
    const granted = capability.permissions.flatMap((permission) => {
      const name = PERMISSION.exec(permission)?.groups?.name;
      return name === undefined ? [] : [name.replaceAll("-", "_")];
    });
    expect(sorted(granted), `${CAPABILITY} must grant exactly APP_COMMANDS\n`).toEqual(appCommands);
    expect(
      { local: capability.local, remote: capability.remote, windows: capability.windows },
      `${CAPABILITY} is the window's, for the bundle's own page alone.\n` +
        `  rule: a static capability with the local origin only, no remote URL and no grant added at runtime\n`,
    ).toEqual({ local: true, remote: undefined, windows: [rustConstant(WINDOW, "MAIN")] });
  });

  it("pushes the update state under the event the page hears", () => {
    const heard = /event: "(?<name>[^"]+)"/u.exec(
      block(CONTRACT, "export const UPDATE_STATE_EVENT", "};"),
    )?.groups?.name;
    expect(heard, `${CONTRACT}'s UPDATE_STATE_EVENT and ${UPDATER}'s disagree\n`).toBe(
      rustConstant(UPDATER, "UPDATE_STATE_EVENT"),
    );
  });

  it("rejects with the error kinds the page reads", () => {
    const thrown = sorted(
      allMatches(block(ERROR, "pub fn kind(", "\n    }\n"), /[=]> "(?<name>[a-z-]+)"/gu),
    );
    const read = sorted(
      allMatches(block(SHELL_ERROR, "kind: z.enum([", "])"), /"(?<name>[a-z-]+)"/gu),
    );
    expect(read, `${ERROR}'s kinds and ${SHELL_ERROR}'s disagree\n`).toEqual(thrown);
  });

  it("runs the page on the origin the cloud lets read its answers", () => {
    expect(
      rustConstant(WINDOW, "PAGE_ORIGIN"),
      `${WINDOW}'s PAGE_ORIGIN is not MAC_APP_ORIGIN, the one origin the Worker answers CORS for\n`,
    ).toBe(MAC_APP_ORIGIN);
  });

  it("lets a release reach the production cloud alone", () => {
    expect(rustConstant(CLOUD, "PRODUCTION_CLOUD_ORIGIN")).toBe(PRODUCTION_CLOUD_ORIGIN);
    const { csp } = tauriConfig().app.security;
    const socket = PRODUCTION_CLOUD_ORIGIN.replace(/^https:/u, "wss:");
    expect(
      sorted(sources(csp, "connect-src")),
      `${TAURI_CONFIG}'s connect-src names more or less than the page's own origin, Tauri's IPC and the cloud.\n` +
        `  rule: the page's calls and its socket reach the cloud's exact origin, and nothing else\n`,
    ).toEqual(sorted(["'self'", ...TAURI_IPC_ORIGINS, PRODUCTION_CLOUD_ORIGIN, socket]));
    expect(sources(csp, "script-src"), `${TAURI_CONFIG} lets a script in from elsewhere`).toEqual([
      "'self'",
    ]);
  });

  it("lets a local build reach this machine alone", () => {
    const local = localConfig().app.security.csp;
    expect(Object.keys(local), `${LOCAL_CONFIG} changes more than where the page may call`).toEqual(
      ["connect-src"],
    );
    const remote = sources(local, "connect-src").filter(
      (source) =>
        !["'self'", ...TAURI_IPC_ORIGINS].includes(source) &&
        !/^(?:http|ws):\/\/(?:localhost|127\.0\.0\.1):\*$/u.test(source),
    );
    expect(remote, `${LOCAL_CONFIG} lets the page call off this machine`).toEqual([]);
  });

  it("makes a local build an app of its own, the one bundle id its shell runs under", () => {
    expect(
      localConfig().identifier,
      `${LOCAL_CONFIG}'s identifier is not ${TAURI_CONFIG}'s with ${CLOUD}'s DEBUG_IDENTITY_SUFFIX.\n` +
        `  rule: a debug build's data, caches and Keychain item are its own, so a sign-in to this machine's Worker never touches the release's; the shell refuses to run as anything else\n`,
    ).toBe(`${tauriConfig().identifier}${rustConstant(CLOUD, "DEBUG_IDENTITY_SUFFIX")}`);
  });

  it("draws the library's files from the shell's own scheme", () => {
    const scheme = rustConstant(FILE_SCHEME, "SCHEME");
    expect(rustConstant(FILE_SCHEME, "ORIGIN")).toBe(`${scheme}://localhost`);
    const { csp } = tauriConfig().app.security;
    for (const directive of ["img-src", "media-src", "object-src"]) {
      expect(
        sources(csp, directive),
        `${TAURI_CONFIG}'s ${directive} does not let the page draw a file from ${scheme}:`,
      ).toContain(`${scheme}:`);
    }
  });

  it("isolates the page's messages to the shell, through a classic script", () => {
    const { pattern, csp } = tauriConfig().app.security;
    expect(pattern.options.dir).toBe("../isolation");
    const page = sourceOf(ISOLATION_PAGE);
    expect(page, `${ISOLATION_PAGE} loads no hook`).toContain('<script src="index.js"></script>');
    expect(page, `${ISOLATION_PAGE} loads a module, which the frame cannot run`).not.toContain(
      'type="module"',
    );
    // Tauri adds the isolation frame's origin, a scheme unique to each launch, to default-src
    // alone, so a frame-src or a child-src would refuse the frame every message passes through
    expect(
      [csp["frame-src"], csp["child-src"]],
      `${TAURI_CONFIG} names a frame policy, which would refuse the isolation frame`,
    ).toEqual([undefined, undefined]);
  });

  it("opens the app by the bundle id the shell is built under", () => {
    const named = /export const APP_BUNDLE_ID = "(?<value>[^"]+)";/u.exec(sourceOf(APP_IDENTITY))
      ?.groups?.value;
    expect(
      named,
      `${APP_IDENTITY}'s APP_BUNDLE_ID is not ${TAURI_CONFIG}'s identifier.\n` +
        `  rule: the browser's door opens the app by its bundle id, so a renamed bundle is an app the door can never open\n`,
    ).toBe(tauriConfig().identifier);
  });
});
