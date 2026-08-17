#!/usr/bin/env node
// The `npx inteligir` entry.
//
// THE SERVER RUNS IN THIS PROCESS. The product is one Node process; a
// supervisor around a single child would buy restart-on-crash and pay for it
// with a PID file, a health poll, a signal-forwarding path and two places for
// the exit code to come from — and none of that helps the failure this shape
// actually has, which is a boot that throws. So the launcher resolves the
// command line, hands the decision to the app's own boot as environment, and
// imports it: one process, one exit code, and ^C reaching the code that owns
// the vault directly. (The Electron shell is the opposite case and supervises,
// because there the server is a child of a UI process that must outlive it.)

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LAUNCHER_USAGE, parseLauncherArgs, resolveLauncherEnv } from "./args";
import { openBrowser } from "./open-browser";

/** This entry is bundled to `<root>/dist/inteligir.mjs`, with the app and CLI
 *  trees staged beside it as `dist/apps/{app,cli}` — the layout the app's own
 *  resolvers expect (scripts/build.mjs says why). */
const distUrl = new URL("./", import.meta.url);
const appEntryUrl = new URL("apps/app/dist-node/main.js", distUrl);
const packageRootUrl = new URL("../", distUrl);

/** The one string each of the two JSON-ish inputs must carry. Hand-narrowed
 *  rather than parsed with a schema library: this bundle is what `npx` fetches
 *  before anything is running, and a validator would be most of its bytes. */
function requiredString(source: unknown, key: string, origin: string): string {
  if (typeof source !== "object" || source === null || !(key in source)) {
    throw new Error(`${origin} has no ${key}`);
  }
  const value: unknown = Reflect.get(source, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${origin}'s ${key} is not a non-empty string`);
  }
  return value;
}

function readVersion(): string {
  const path = new URL("package.json", packageRootUrl);
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return requiredString(raw, "version", fileURLToPath(path));
}

async function boot(): Promise<void> {
  const command = parseLauncherArgs(process.argv.slice(2));
  switch (command.kind) {
    case "help":
      console.log(LAUNCHER_USAGE);
      return;
    case "version":
      console.log(readVersion());
      return;
    case "error":
      console.error(command.message);
      process.exitCode = 2;
      return;
    case "boot":
      break;
  }

  // Set BEFORE the import: the app's boot reads its configuration at module
  // evaluation, so an assignment after it would be read by nothing.
  Object.assign(process.env, resolveLauncherEnv({ options: command.options, cwd: process.cwd() }));
  process.env.NODE_ENV = "production";

  if (!existsSync(appEntryUrl)) {
    throw new Error(
      `the app bundle is missing (${fileURLToPath(appEntryUrl)}) — this install is incomplete`,
    );
  }
  const appModule: unknown = await import(appEntryUrl.href);
  const serverUrl = requiredString(appModule, "serverUrl", fileURLToPath(appEntryUrl));
  console.log(`\n  inteligir is running — ${serverUrl}\n`);
  if (command.options.open) {
    openBrowser(process.platform, serverUrl);
  }
}

try {
  await boot();
} catch (error) {
  console.error(
    `inteligir failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
