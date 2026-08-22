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
import { asMapping, isText, parseJsonSource, type JsonValue } from "./json-source";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const COMPONENTS_DIR = path.join(PACKAGE_ROOT, "src", "components");
const MANIFEST_PATH = path.join(PACKAGE_ROOT, "components.provenance.json");
const CONFIG_PATH = path.join(PACKAGE_ROOT, "components.json");

type ProvenanceEntry =
  | { origin: "registry"; item: string; sha256: string }
  | { origin: "fluid"; item: string; sha256: string }
  | { origin: "local"; sha256: string };

/** Which registry preset the components were pulled from. */
interface RegistryIdentity {
  style: string;
  baseColor: string;
}

type Provenance = {
  registry: RegistryIdentity;
  /** The fluid registry's url template — mirrored from components.json's
   * "@fluid" registry, which is what the shadcn CLI actually resolves. */
  fluidUrl: string;
  components: Record<string, ProvenanceEntry>;
};

const SHA256 = /^[\da-f]{64}$/;

function parseEntry(name: string, value: JsonValue | undefined): ProvenanceEntry {
  const fields = asMapping(value) ?? {};
  const { origin, item, sha256 } = fields;
  if (!isText(sha256) || !SHA256.test(sha256)) {
    throw new Error(`components.provenance.json: "${name}" has no valid sha256`);
  }
  if (origin === "local") return { origin: "local", sha256 };
  if (origin === "registry" && isText(item)) {
    return { origin: "registry", item, sha256 };
  }
  if (origin === "fluid" && isText(item)) {
    return { origin: "fluid", item, sha256 };
  }
  throw new Error(
    `components.provenance.json: "${name}" needs origin "local", or "registry"/"fluid" with an "item".`,
  );
}

/** Parse at the boundary: the manifest is generated data on disk, so the test
 * refuses a shape it cannot reason about rather than reading through `any`. */
function parseProvenance(raw: string): Provenance {
  const value = asMapping(parseJsonSource(raw));
  const registry = asMapping(value?.["registry"]);
  const fluid = asMapping(value?.["fluid"]);
  const componentsSource = asMapping(value?.["components"]);
  if (!registry || !fluid || !componentsSource) {
    throw new Error("components.provenance.json: expected { registry, fluid, components }");
  }
  const { style, baseColor } = registry;
  if (!isText(style) || !isText(baseColor)) {
    throw new Error("components.provenance.json: registry needs a string style and baseColor");
  }
  const fluidUrl = fluid["url"];
  if (!isText(fluidUrl)) {
    throw new Error("components.provenance.json: fluid needs a string url");
  }
  const components: Record<string, ProvenanceEntry> = {};
  for (const [name, entry] of Object.entries(componentsSource)) {
    components[name] = parseEntry(name, entry);
  }
  return { registry: { style, baseColor }, fluidUrl, components };
}

function parseFluidRegistryUrl(raw: string): string {
  const value = asMapping(parseJsonSource(raw));
  const registries = asMapping(value?.["registries"]);
  const url = registries?.["@fluid"];
  if (!isText(url)) {
    throw new Error('components.json: expected registries["@fluid"] url template');
  }
  return url;
}

function parseShadcnConfig(raw: string): RegistryIdentity {
  const value = asMapping(parseJsonSource(raw));
  const tailwind = asMapping(value?.["tailwind"]);
  if (!value || !tailwind) {
    throw new Error("components.json: expected { style, tailwind }");
  }
  const { style } = value;
  const { baseColor } = tailwind;
  if (!isText(style) || !isText(baseColor)) {
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

  it("agrees with components.json on the fluid registry url", () => {
    // Same mirror rule as the shadcn block below: components.json is what the
    // CLI resolves "@fluid/..." against, the manifest only records it.
    expect(provenance.fluidUrl).toBe(parseFluidRegistryUrl(fs.readFileSync(CONFIG_PATH, "utf8")));
  });

  it("agrees with components.json on the registry style", () => {
    // The shadcn CLI reads components.json; the manifest only mirrors it. A
    // silent divergence would attribute files to a preset they never came from.
    expect(provenance.registry).toEqual(parseShadcnConfig(fs.readFileSync(CONFIG_PATH, "utf8")));
  });
});
