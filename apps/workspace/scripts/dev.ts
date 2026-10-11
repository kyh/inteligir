// `pnpm dev:workspace`: the page's own loop, with no shell and no Rust. Vite serves the page's
// files, and this checkout's server, from source, answers them from it in place of the bundle
// (apps/cli/src/server/ui-dev-server.ts) and opens a browser tab on itself, so the tab keeps the
// server's origin, its sign-in and its socket, as the window does under `tauri dev`, and an edit
// reloads in place. Vite listens first, so the tab's first load never meets a server forwarding
// to nothing.
//
// Ctrl+C reaches the server on its own, as the whole foreground group, so SIGINT and SIGHUP are
// only listened for here, never relayed: a second copy is the server's cue to skip the vault
// flush. SIGTERM reaches this process alone, so it is forwarded. Vite closes once the server has
// gone, and this process exits as it did (apps/cli/bin/inteligir does the same).

import { spawn } from "node:child_process";
import { constants } from "node:os";
import path from "node:path";
import { createServer } from "vite";

// the name the server reads it under (apps/cli/src/server/ui-dev-server.ts), which a script node
// runs as it stands cannot import; tools/repo-guards/src/desktop-shell-wire.test.ts holds the two
const UI_DEV_URL_ENV_VAR = "INTELIGIR_UI_DEV_URL";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cliBin = path.resolve(packageRoot, "..", "cli", "bin", "inteligir");

const vite = await createServer({ configFile: path.join(packageRoot, "vite.config.ts") });
await vite.listen();
const pageUrl = vite.resolvedUrls?.local[0];
if (pageUrl === undefined) {
  await vite.close();
  throw new Error("Vite is listening on no local address");
}

const server = spawn(process.execPath, [cliBin, "serve", "--open"], {
  env: { ...process.env, [UI_DEV_URL_ENV_VAR]: pageUrl },
  stdio: "inherit",
});

const exitWith = async (exitCode: number): Promise<void> => {
  await vite.close();
  process.exit(exitCode);
};

// heard, so node's default does not end this process before the server's flush
const awaitServer = (): void => {
  // the server heard it too, as the foreground group, and its exit ends this process
};
process.on("SIGINT", awaitServer);
process.on("SIGHUP", awaitServer);
process.on("SIGTERM", () => server.kill("SIGTERM"));

server.on("exit", (code, signal) => {
  const signalNumber = signal === null ? undefined : constants.signals[signal];
  void exitWith(signalNumber === undefined ? (code ?? 1) : 128 + signalNumber);
});

server.on("error", (error) => {
  process.stderr.write(`dev: the server did not start (${error.message})\n`);
  void exitWith(1);
});
