import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { makeTempDir } from "../../__tests__/temp-dir";

// stands in for both vendors' `mcp` verbs over the stores they keep: claude's `.claude.json` in its
// real shape (the port reads it directly) and a servers.json for codex, whose `mcp list --json`
// answers in codex's own. Every run records its argv, cwd, pid and whether its stdin was a
// terminal. A sign-in (`mcp login`, and a codex `mcp add --url` told to start one) prints an
// address and waits for a release file, or fails when FAKE_SIGN_IN=fail; claude's refuses without
// a terminal, as the real one does.
// through env, not process.execPath: a shebang cannot carry a path with a space in it.
const FAKE_VENDOR = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const vendor = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const log = process.env.FAKE_VENDOR_LOG;
fs.appendFileSync(
  path.join(log, "runs.jsonl"),
  JSON.stringify({ args, cwd: process.cwd(), pid: process.pid, tty: process.stdin.isTTY === true, vendor }) + "\\n",
);
const readJson = (file, empty) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : empty);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const signIn = (name) => {
  console.log("If the browser didn't open, visit: https://auth.test/authorize?server=" + name);
  if (process.env.FAKE_SIGN_IN === "fail") {
    fail("the provider refused the sign-in");
  }
  setInterval(() => {
    if (fs.existsSync(path.join(log, "release"))) {
      console.log("Authenticated with " + name);
      process.exit(0);
    }
  }, 20);
};
const afterDashes = () => args.slice(args.indexOf("--") + 1);

if (vendor === "claude") {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json");
  const config = readJson(file, {});
  config.mcpServers ??= {};
  const [verb] = args.slice(1);
  if (verb === "add-json") {
    const [name, json] = afterDashes();
    if (config.mcpServers[name] !== undefined) {
      fail("MCP server " + name + " already exists in user config");
    }
    config.mcpServers[name] = JSON.parse(json);
    fs.writeFileSync(file, JSON.stringify(config));
  } else if (verb === "remove") {
    const [name] = afterDashes();
    if (config.mcpServers[name] === undefined) {
      fail('No MCP server named "' + name + '" in user scope');
    }
    delete config.mcpServers[name];
    fs.writeFileSync(file, JSON.stringify(config));
  } else if (verb === "login") {
    const [name] = afterDashes();
    if (!process.stdin.isTTY) {
      fail("stdin isn't a terminal, so authentication can't be completed here.");
    }
    signIn(name);
  }
} else {
  const file = path.join(process.env.CODEX_HOME, "servers.json");
  const servers = readJson(file, {});
  const [verb] = args.slice(1);
  if (verb === "list") {
    console.log(JSON.stringify(Object.entries(servers).map(([name, row]) => ({ name, ...row }))));
  } else if (verb === "add") {
    const name = args[2];
    const url = args[3] === "--url" ? args[4] : null;
    servers[name] =
      url === null
        ? { auth_status: "unsupported", transport: { args: afterDashes().slice(1), command: afterDashes()[0], type: "stdio" } }
        : { auth_status: "not_logged_in", transport: { type: "streamable_http", url } };
    fs.writeFileSync(file, JSON.stringify(servers));
    console.log("Added global MCP server '" + name + "'.");
    if (url !== null && process.env.FAKE_CODEX_ADD_SIGN_IN === "1") {
      console.log("Detected OAuth support. Starting OAuth flow…");
      signIn(name);
    }
  } else if (verb === "remove") {
    const [name] = afterDashes();
    delete servers[name];
    fs.writeFileSync(file, JSON.stringify(servers));
  } else if (verb === "login") {
    const [name] = afterDashes();
    if (servers[name] === undefined) {
      fail("Error: No MCP server named '" + name + "' found.");
    }
    signIn(name);
  }
}
`;

const runSchema = z.object({
  args: z.array(z.string()),
  cwd: z.string(),
  pid: z.number(),
  tty: z.boolean(),
  vendor: z.enum(["claude", "codex"]),
});
export type FakeVendorRun = z.infer<typeof runSchema>;

export interface FakeMcpVendors {
  root: string;
  dataDir: string;
  vaultDir: string;
  env: NodeJS.ProcessEnv;
  claudeConfigFile: string;
  runs: () => FakeVendorRun[];
  // lets every waiting sign-in finish as the browser would.
  release: () => void;
}

export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const fakeMcpVendors = (extraEnv: NodeJS.ProcessEnv = {}): FakeMcpVendors => {
  const root = makeTempDir("fake-mcp-vendor-", { realpath: true });
  const dirs = {
    claude: path.join(root, "claude-config"),
    codex: path.join(root, "codex-home"),
    data: path.join(root, "data"),
    log: path.join(root, "log"),
    vault: path.join(root, "vault"),
  };
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir);
  }
  const claude = path.join(root, "claude");
  const codex = path.join(root, "codex");
  for (const executable of [claude, codex]) {
    writeFileSync(executable, FAKE_VENDOR, { mode: 0o755 });
  }
  const runsFile = path.join(dirs.log, "runs.jsonl");
  return {
    claudeConfigFile: path.join(dirs.claude, ".claude.json"),
    dataDir: dirs.data,
    env: {
      CLAUDECODE: "1",
      CLAUDE_CODE_EXECUTABLE: claude,
      CLAUDE_CONFIG_DIR: dirs.claude,
      CODEX_HOME: dirs.codex,
      CODEX_PATH: codex,
      FAKE_VENDOR_LOG: dirs.log,
      HOME: root,
      PATH: process.env.PATH,
      ...extraEnv,
    },
    release: () => {
      writeFileSync(path.join(dirs.log, "release"), "");
    },
    root,
    runs: () =>
      existsSync(runsFile)
        ? readFileSync(runsFile, "utf-8")
            .trim()
            .split("\n")
            .map((line) => runSchema.parse(JSON.parse(line)))
        : [],
    vaultDir: dirs.vault,
  };
};
