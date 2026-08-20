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
import { z } from "zod";
import { LAUNCHER_USAGE, parseLauncherArgs, resolveLauncherEnv } from "./args";
import { openBrowser } from "./open-browser";

/** This entry is bundled to `<root>/dist/inteligir.mjs`, with the app and CLI
 *  trees staged beside it as `dist/apps/{app,cli}` — the layout the app's own
 *  resolvers expect (scripts/build.mjs says why). */
const distUrl = new URL("./", import.meta.url);
const appEntryUrl = new URL("apps/app/dist-node/main.js", distUrl);
const packageRootUrl = new URL("../", distUrl);

/** A value from outside this bundle, before anything has read it: the parsed
 *  package.json, and the app bundle's module namespace. */
type ExternalValue = NonNullable<unknown>;

/** Any keyed source, with its values still unread — the two inputs below are
 *  shaped differently (a JSON object, a module namespace) and only the one key
 *  each is asked for. */
const keyedSource = z.record(z.string(), z.unknown());

/** The one string each of the two JSON-ish inputs must carry. A missing key
 *  and a key holding the wrong thing are different failures: the first means
 *  the file or bundle is not what it claims to be, the second that it is
 *  damaged. */
function requiredString(source: ExternalValue, key: string, origin: string): string {
  const fields = keyedSource.safeParse(source);
  if (!fields.success || !(key in fields.data)) {
    throw new Error(`${origin} has no ${key}`);
  }
  const value = z.string().min(1).safeParse(fields.data[key]);
  if (!value.success) {
    throw new Error(`${origin}'s ${key} is not a non-empty string`);
  }
  return value.data;
}

function readVersion(): string {
  const path = new URL("package.json", packageRootUrl);
  return requiredString(JSON.parse(readFileSync(path, "utf8")), "version", fileURLToPath(path));
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
  const appModule = await import(appEntryUrl.href);
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
  // EXIT, do not merely set a code. The app's boot forks a filesystem watcher
  // before it binds a port, and that child's IPC channel is a live handle: a
  // failure after the fork (an occupied port is the ordinary one) leaves an
  // event loop that never drains, so `npx inteligir` would print its error and
  // then hang forever with nothing listening. The app tears its own resources
  // down and exits on its own boot failures; this is the backstop for
  // everything before and around that — a missing bundle, a bad export.
  process.exit(1);
}
