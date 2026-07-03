// ---------------------------------------------------------------------------
// inteligir [vault-path] — boot the local host + server and open the app in
// the default browser. The vault defaults to the current directory; loopback
// is the auth gate (see ./create-server).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import open from "open";

import { createHost } from "@repo/host/create-host";

import { createServer } from "./create-server";
import { createServerPlatform } from "./server-platform";

const HELP = `inteligir — your vault, in a browser

Usage: inteligir [vault-path] [options]

  vault-path      Folder of markdown notes to open (default: current dir)

Options:
  --port <n>      Fixed TCP port (default: pick a free one)
  --no-open       Don't open the browser automatically
  -h, --help      Show this help
`;

const SHUTDOWN_TIMEOUT_MS = 5_000;

function fail(message: string): never {
  console.error(`inteligir: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (positionals.length > 1) fail("expected at most one vault path (see --help)");

  const vaultPath = path.resolve(positionals[0] ?? process.cwd());
  const existing = fs.statSync(vaultPath, { throwIfNoEntry: false });
  if (existing && !existing.isDirectory()) fail(`${vaultPath} is not a directory`);

  let port = 0;
  if (values.port !== undefined) {
    port = Number.parseInt(values.port, 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail("--port must be 0–65535");
  }

  // The web build ships inside @repo/app (dist-web/); in-repo it comes from
  // `pnpm build`.
  const appPackageJson = createRequire(import.meta.url).resolve("@repo/app/package.json");
  const assetsDir = path.join(path.dirname(appPackageJson), "dist-web");
  if (!fs.existsSync(path.join(assetsDir, "index.html"))) {
    fail(`app web build missing at ${assetsDir} — run \`pnpm build\` first`);
  }

  const host = createHost(createServerPlatform(), { vaultPath });

  // Transport fold before host.start() so no early event is dropped.
  const server = await createServer({ host, assetsDir, port });
  try {
    host.start();
  } catch (err) {
    await server.close().catch(() => {});
    throw err;
  }

  console.log(`\n  inteligir`);
  console.log(`  vault  ${vaultPath}`);
  console.log(`  url    ${server.url}\n`);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[inteligir] ${signal} — shutting down`);
    // A wedged teardown must not hold the process hostage.
    const watchdog = setTimeout(() => {
      console.error(`[inteligir] shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — exiting`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    void (async () => {
      await server.close().catch((err: unknown) => {
        console.error("[inteligir] server close failed:", err);
      });
      // dispose() shuts down agents + executor daemon and releases the host lock.
      await host.dispose().catch((err: unknown) => {
        console.error("[inteligir] host dispose failed:", err);
      });
      clearTimeout(watchdog);
      process.exit(0);
    })();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (!values["no-open"]) {
    await open(server.url).catch((err: unknown) => {
      console.warn("[inteligir] could not open the browser:", err);
    });
  }
}

main().catch((err: unknown) => {
  console.error("inteligir failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
