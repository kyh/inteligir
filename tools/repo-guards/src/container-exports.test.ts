// ---------------------------------------------------------------------------
// The container's two by-NAME couplings, which the type system cannot express.
//
// The Sandbox SDK resolves both of these from the Worker entry's exports at
// runtime, by the name they are exported under:
//
//   • `AgentSandbox` — the Durable Object class wrangler.jsonc binds. Missing
//     it fails the deploy, loudly.
//   • `ContainerProxy` — the WorkerEntrypoint the SDK constructs outbound
//     interception fetchers from. Missing it takes the CREDENTIAL SEAM with it:
//     provider requests still leave (the firewall allows those hosts), still
//     carry the placeholder key, and the only symptom is a model that will not
//     answer.
//
// The deployed entry is `server.ts` and the suite's entry is `index.ts`, so the
// Workers tests can only ever prove the second one. This reads both files.
// Textual on purpose: `server.ts` imports the site's SSR entry, whose virtual
// modules exist only inside a TanStack Start build, so it cannot be imported
// here — and the thing being checked is which NAMES the module exports, which
// is exactly what the text says.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const WORKER_SRC = path.join(REPO_ROOT, "apps/web/src/worker");

/** Every module workerd may enter this Worker through. Each one's exports ARE
 * the `ctx.exports` the SDK reads. */
const ENTRIES = ["server.ts", "index.ts"];

/** The names each entry must export, and what is lost without them. */
const REQUIRED = [
  { name: "UserHost", why: "every Durable Object binding resolves against the entry's exports" },
  { name: "AgentSandbox", why: "the container's Durable Object class" },
  {
    name: "ContainerProxy",
    why: "the SDK builds outbound-interception fetchers from it, so the provider credential seam disappears without it",
  },
];

/** Whether `source` exports `name` — as a re-export (`export { X } from …`), a
 * local re-export (`export { X }`) or a declaration. */
function exportsName(source: string, name: string): boolean {
  const listed = new RegExp(String.raw`export\s*\{[^}]*\b${name}\b[^}]*\}`).test(source);
  const declared = new RegExp(String.raw`export\s+(?:class|const|function)\s+${name}\b`).test(
    source,
  );
  return listed || declared;
}

describe("the Worker entry's container exports", () => {
  for (const entry of ENTRIES) {
    it(`${entry} exports every class the Sandbox SDK resolves by name`, () => {
      const file = path.join(WORKER_SRC, entry);
      const source = fs.readFileSync(file, "utf8");
      const missing = REQUIRED.filter((required) => !exportsName(source, required.name)).map(
        (required) => `  ${required.name} — ${required.why}`,
      );
      expect(
        missing,
        `src/worker/${entry} must export these by name:\n${missing.join("\n")}`,
      ).toEqual([]);
    });
  }

  // A floor: a renamed or moved entry must fail here rather than pass by
  // reading a file that no longer carries the Worker.
  it("both entries exist", () => {
    for (const entry of ENTRIES) {
      expect(fs.existsSync(path.join(WORKER_SRC, entry)), entry).toBe(true);
    }
  });
});
