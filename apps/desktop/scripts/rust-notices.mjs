// The Rust crates the shell links into its one binary, and the notices their licences ask to travel
// with it: each crate with its version, licence and source, then every licence text the crates
// ship, each text once beside the crates it covers. Read from cargo's own resolve for the Mac
// target, through normal edges alone and never into a proc macro, which the compiler runs rather
// than links, so a crate only another platform links, only the build runs or only a macro uses is
// not listed. A crate that ships no text of its own is still listed with its licence.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const TARGET = "aarch64-apple-darwin";
const LICENCE_FILE = /^(?:(?:un)?licen[cs]e|copying|notice|copyright)/iu;

const cargoMetadata = (manifestDir) => {
  const result = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--filter-platform", TARGET],
    { cwd: manifestDir, encoding: "utf-8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`cargo metadata exited ${result.status ?? result.signal}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
};

const isProcMacro = (entry) => entry.targets.some((target) => target.kind.includes("proc-macro"));

// the root's normal dependencies, transitively: what is compiled into the binary
const linkedPackages = (metadata) => {
  const packages = new Map(metadata.packages.map((entry) => [entry.id, entry]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const { root } = metadata.resolve;
  const linked = new Set();
  const pending = [root];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!linked.has(id)) {
      linked.add(id);
      for (const dep of nodes.get(id).deps) {
        if (
          dep.dep_kinds.some((kind) => kind.kind === null) &&
          !isProcMacro(packages.get(dep.pkg))
        ) {
          pending.push(dep.pkg);
        }
      }
    }
  }
  linked.delete(root);
  return [...linked]
    .map((id) => packages.get(id))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
};

const licenceFiles = (entry) => {
  const dir = path.dirname(entry.manifest_path);
  const named = readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isFile() && LICENCE_FILE.test(item.name))
    .map((item) => item.name);
  const declared = entry.license_file === null ? [] : [entry.license_file];
  return [...new Set([...named, ...declared])]
    .toSorted()
    .map((name) => ({ name, text: readFileSync(path.resolve(dir, name), "utf-8").trim() }));
};

export const writeRustNotices = async (manifestDir, outFile) => {
  const crates = linkedPackages(cargoMetadata(manifestDir));
  const texts = new Map();
  const lines = [];
  for (const entry of crates) {
    const source = entry.repository ?? `https://crates.io/crates/${entry.name}`;
    lines.push(
      `${entry.name} ${entry.version} — ${entry.license ?? "no licence stated"} — ${source}`,
    );
    for (const file of licenceFiles(entry)) {
      const digest = createHash("sha256").update(file.text).digest("hex");
      const shared = texts.get(digest) ?? { covers: [], text: file.text };
      shared.covers.push(`${entry.name} ${entry.version} (${file.name})`);
      texts.set(digest, shared);
    }
  }
  const sections = [...texts.values()].map(
    ({ covers, text }) => `---- ${covers.join(", ")}\n\n${text}\n`,
  );
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(
    outFile,
    [
      "The Inteligir app's shell is built from the Rust crates below, each listed with its version, its licence and its source. The licence texts the crates ship follow, each once, after the crates it covers.",
      "",
      ...lines,
      "",
      ...sections,
    ].join("\n"),
  );
  return crates.length;
};
