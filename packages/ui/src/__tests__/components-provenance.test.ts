// ---------------------------------------------------------------------------
// Provenance-coverage guard: every file under src/components is recorded in
// components.provenance.json, and every record still has a file.
//
// COVERAGE is the invariant, not content. A vendored component that escapes
// the record has no source identity at all, so a re-pull cannot tell whether
// it came from the registry (overwrite freely) or was written here (never
// overwrite). Drift — a recorded hash no longer matching the bytes — is
// deliberately NOT asserted: local edits to vendored files are sanctioned
// (README § Invariants), so failing on drift would fail on the intended state.
// `pnpm --filter @repo/ui provenance:check` reports it instead.
//
// Sibling of the orphan-component guard: assert the architectural rule as a
// failing test, over a walk of the real tree rather than a maintained list.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const COMPONENTS_DIR = path.join(PACKAGE_ROOT, "src", "components");
const MANIFEST_PATH = path.join(PACKAGE_ROOT, "components.provenance.json");
const CONFIG_PATH = path.join(PACKAGE_ROOT, "components.json");

type ProvenanceEntry =
  | { origin: "registry"; item: string; sha256: string }
  | { origin: "local"; sha256: string };

type Provenance = {
  registry: { style: string; baseColor: string };
  components: Record<string, ProvenanceEntry>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const SHA256 = /^[\da-f]{64}$/;

function parseEntry(name: string, value: unknown): ProvenanceEntry {
  const fields = isRecord(value) ? value : {};
  const { origin, item, sha256 } = fields;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    throw new Error(`components.provenance.json: "${name}" has no valid sha256`);
  }
  if (origin === "local") return { origin: "local", sha256 };
  if (origin === "registry" && typeof item === "string") {
    return { origin: "registry", item, sha256 };
  }
  throw new Error(
    `components.provenance.json: "${name}" needs origin "local", or "registry" with an "item".`,
  );
}

/** Parse at the boundary: the manifest is generated data on disk, so the test
 * refuses a shape it cannot reason about rather than reading through `any`. */
function parseProvenance(raw: string): Provenance {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !isRecord(value.registry) || !isRecord(value.components)) {
    throw new Error("components.provenance.json: expected { registry, components }");
  }
  const { style, baseColor } = value.registry;
  if (typeof style !== "string" || typeof baseColor !== "string") {
    throw new Error("components.provenance.json: registry needs a string style and baseColor");
  }
  const components: Record<string, ProvenanceEntry> = {};
  for (const [name, entry] of Object.entries(value.components)) {
    components[name] = parseEntry(name, entry);
  }
  return { registry: { style, baseColor }, components };
}

function parseShadcnConfig(raw: string): { style: string; baseColor: string } {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !isRecord(value.tailwind)) {
    throw new Error("components.json: expected { style, tailwind }");
  }
  const { style } = value;
  const { baseColor } = value.tailwind;
  if (typeof style !== "string" || typeof baseColor !== "string") {
    throw new Error("components.json: expected string style and tailwind.baseColor");
  }
  return { style, baseColor };
}

function componentNames(): string[] {
  return fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name.replace(/\.tsx$/, ""))
    .toSorted();
}

const REGENERATE = "Run `pnpm --filter @repo/ui provenance` to regenerate.";

describe("component provenance", () => {
  const provenance = parseProvenance(fs.readFileSync(MANIFEST_PATH, "utf8"));

  it("records every file under src/components", () => {
    const unrecorded = componentNames().filter((name) => !(name in provenance.components));

    expect(
      unrecorded,
      `Vendored components with no provenance record — nothing says where they came from.\n` +
        `${REGENERATE} A component written HERE needs its origin set to "local" by hand:\n` +
        unrecorded.map((name) => `  packages/ui/src/components/${name}.tsx`).join("\n"),
    ).toEqual([]);
  });

  it("records nothing that is no longer on disk", () => {
    const names = new Set(componentNames());
    const stale = Object.keys(provenance.components).filter((name) => !names.has(name));

    expect(stale, `Provenance records for deleted components. ${REGENERATE}`).toEqual([]);
  });

  it("agrees with components.json on the registry style", () => {
    // The shadcn CLI reads components.json; the manifest only mirrors it. A
    // silent divergence would attribute files to a preset they never came from.
    expect(provenance.registry).toEqual(parseShadcnConfig(fs.readFileSync(CONFIG_PATH, "utf8")));
  });
});
