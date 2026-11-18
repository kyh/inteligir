import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";

// The notices a licence asks to travel with a copy, for every package the site is built from:
// Turbopack has no counterpart of Vite's build.license, so pnpm lists them. `@repo/web...` follows
// the workspace packages the site imports, whose own dependencies a bare `@repo/web` leaves out;
// --filter-prod skips a workspace package reached only as a devDependency.
const SITE = ["--filter-prod", "@repo/web..."];

const pnpm = (args: readonly string[]): string =>
  execFileSync("pnpm", args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });

const report = z.record(
  z.string(),
  z.array(
    z.object({
      license: z.string(),
      name: z.string(),
      paths: z.array(z.string()),
      versions: z.array(z.string()),
    }),
  ),
);

const workspaces = z.array(z.object({ path: z.string() }));

// the file names Vite's build.license reads a package's text from
const LICENCE_FILE = /^(?:license|licence|copying)/iu;

const licenceText = (dir: string): string | undefined => {
  const file = readdirSync(dir, { withFileTypes: true }).find(
    (entry) => entry.isFile() && LICENCE_FILE.test(entry.name),
  );
  return file === undefined ? undefined : readFileSync(path.join(dir, file.name), "utf-8").trim();
};

const byText = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const sections = Object.values(
  report.parse(JSON.parse(pnpm(["licenses", "list", "--prod", "--json", ...SITE]))),
)
  .flat()
  .flatMap(({ license, name, paths, versions }) =>
    versions.map((version, index) => ({ dir: paths[index], license, name, version })),
  )
  .toSorted((a, b) => byText(a.name, b.name) || byText(a.version, b.version))
  .map(({ dir, license, name, version }) => {
    const text = dir === undefined ? undefined : licenceText(dir);
    return `## ${name} - ${version} (${license})\n${text === undefined ? "" : `\n${text}\n`}`;
  });

// what a workspace the site is built from vendored, whose licence it keeps in its licenses/
const vendored = workspaces
  .parse(JSON.parse(pnpm(["ls", "--json", "--depth", "-1", ...SITE])))
  .flatMap(({ path: dir }) => {
    const texts = path.join(dir, "licenses");
    return existsSync(texts)
      ? readdirSync(texts).map((name) => ({ name, source: path.join(texts, name) }))
      : [];
  })
  .toSorted((a, b) => byText(a.name, b.name));

const VENDORED = new URL("../public/licenses/", import.meta.url);
rmSync(VENDORED, { force: true, recursive: true });
mkdirSync(VENDORED);
for (const { name, source } of vendored) {
  copyFileSync(source, new URL(name, VENDORED));
}

const links = vendored.map(({ name }) => `- [${path.parse(name).name}](/licenses/${name})`);

writeFileSync(
  new URL("../public/licenses.md", import.meta.url),
  `# Licenses\n\nThe site holds code copied from these projects, under their licenses:\n\n${links.join("\n")}\n\nThe site is built from packages under the following licenses:\n\n${sections.join("\n")}`,
);
