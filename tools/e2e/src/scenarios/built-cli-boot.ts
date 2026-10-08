import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const manifestSchema = z.looseObject({ version: z.string() });
const statusOutputSchema = z.looseObject({ dataDir: z.string(), version: z.string() });

export const builtCliBoot: Scenario = {
  description:
    "the esbuild bundle npm and the .app run boots, migrates, answers its API and serves its UI",
  name: "built-cli-boot",
  // no build step: the runner builds this bundle at suite start, through turbo.
  async run(ctx) {
    const cliDir = path.join(ctx.repoRoot, "apps", "cli");
    const distDir = path.join(cliDir, "dist");
    const app = await ctx.boot({ mode: "built", name: "built" });

    ctx.log("GET / answers the staged workspace UI");
    const server = readServerFile(app.dataDir);
    expect(server !== null, "the built server published no server.json");
    // a GET with no credential is the signed-out page, never the workspace.
    const shell = await fetch(app.baseUrl, {
      headers: { accept: "text/html", authorization: authorizationHeader(server.token) },
    });
    expectEq(shell.status, 200, "GET / on the built server");
    const staged = await readFile(path.join(distDir, "ui", "index.html"), "utf-8");
    expect((await shell.text()) === staged, "GET / answers dist/ui/index.html byte for byte");

    ctx.log("a thread created through the API lists, over the migrated database");
    const { thread } = await app.api.threads.create({ title: "built" });
    const { threads } = await app.api.threads.list({});
    expect(
      threads.some((listed) => listed.id === thread.id),
      "the built server lists the thread it created",
    );

    // a client verb loads other chunks than serve does, and reads the version through the
    // package-root rule a misplaced chunk would break.
    ctx.log("a client verb from the same bundle drives the server");
    const status = await exec(
      process.execPath,
      [path.join(distDir, "index.js"), "status", "--json"],
      {
        env: { ...hermeticProcessEnv(), INTELIGIR_DATA_DIR: app.dataDir, NODE_ENV: "production" },
      },
    );
    const reported = statusOutputSchema.parse(JSON.parse(status.stdout));
    expectEq(reported.dataDir, app.dataDir, "status --json names the instance's data dir");
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(path.join(cliDir, "package.json"), "utf-8")),
    );
    expectEq(reported.version, manifest.version, "the version the bundle read from package.json");
  },
};
