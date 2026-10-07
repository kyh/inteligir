import { execFileSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import { AGENT_BIN_DIR_NAME, writeAgentLauncher } from "../agent-launcher";

// a CLI that prints what it was handed, standing in for the bundle
const echoingCli = (dir: string): string => {
  const entry = path.join(dir, "cli's entry.js");
  writeFileSync(
    entry,
    "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), mode: process.env.NODE_ENV }));\n",
  );
  return entry;
};

describe("the agent's launcher", () => {
  it("runs the app's node on the app's CLI, passing every argument through as given", () => {
    const root = makeTempDir("inteligir-launcher-");
    const dataDir = path.join(root, "it's data");
    mkdirSync(dataDir);
    const binDir = writeAgentLauncher({
      cliEntry: echoingCli(root),
      dataDir,
      node: process.execPath,
      nodeEnv: "production",
    });
    expect(binDir).toBe(path.join(dataDir, AGENT_BIN_DIR_NAME));
    const launcher = path.join(binDir, "inteligir");
    expect(() => {
      accessSync(launcher, constants.X_OK);
    }).not.toThrow();
    const printed = execFileSync(launcher, ["note", "read", "a 'quoted' $name"], {
      encoding: "utf-8",
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(JSON.parse(printed)).toEqual({
      args: ["note", "read", "a 'quoted' $name"],
      mode: "production",
    });
  });

  it("is rewritten at each boot, so a moved app is the one it runs", () => {
    const root = makeTempDir("inteligir-launcher-");
    const args = { cliEntry: echoingCli(root), dataDir: root, nodeEnv: "production" };
    writeAgentLauncher({ ...args, node: "/Applications/Old.app/Contents/MacOS/node" });
    const binDir = writeAgentLauncher({ ...args, node: process.execPath });
    const printed = execFileSync(path.join(binDir, "inteligir"), [], { encoding: "utf-8" });
    expect(JSON.parse(printed)).toEqual({ args: [], mode: "production" });
  });
});
