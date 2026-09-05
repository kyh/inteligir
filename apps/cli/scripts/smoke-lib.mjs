// Shared by the CLI and desktop smokes, which boot different artifacts of the same server.
// A workspace seam only: `publishConfig.exports` drops it from the published package.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const WATCHER_TIMEOUT_MS = 20_000;

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

// the watcher is a forked child its proxy respawns forever, so a child that cannot load its
// platform binding never reaches the server's status; an external write reaching the index is
// the only proof it lives. Written again on each round: the first can land before the child's
// first subscribe.
export async function proveWatcherAlive({ rpc, vaultDir, fail, log }) {
  const token = `smokewatch${Date.now()}`;
  const note = join(vaultDir, "Smoke Watch.md");
  const deadline = Date.now() + WATCHER_TIMEOUT_MS;
  let seen = false;
  for (let round = 0; !seen && Date.now() < deadline; round += 1) {
    writeFileSync(note, `# Smoke Watch\n\n${token} round ${round}\n`);
    for (let poll = 0; poll < 10 && !seen; poll += 1) {
      await delay(500);
      const found = await rpc("knowledge/search", { q: token });
      seen = found.results.length > 0;
    }
  }
  if (!seen) {
    fail(
      `the vault watcher never reported an external write to ${note} within ${WATCHER_TIMEOUT_MS}ms — ` +
        "the forked child is not watching (is @parcel/watcher's platform package in the tree?)",
    );
  }
  log("the watcher reported an external write");
}
