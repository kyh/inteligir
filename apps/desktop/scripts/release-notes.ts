// A release's notes are CHANGELOG.md's top section, printed as the GitHub release's notes file,
// so the GitHub release, the update it ships and the file say one thing. The top section must
// already be titled for this package's version: publishing an Unreleased section, or the last
// release's, would describe some other build.

import { readFileSync } from "node:fs";
import path from "node:path";
import manifest from "../package.json" with { type: "json" };

const packageRoot = path.resolve(import.meta.dirname, "..");
const changelogPath = path.resolve(packageRoot, "../../CHANGELOG.md");
const manifestPath = path.join(packageRoot, "package.json");

const refuse: (sentence: string) => never = (sentence) => {
  process.stderr.write(`release-notes: ${sentence}\n`);
  process.exit(1);
};

const { version } = manifest;
if (!/^\d+\.\d+\.\d+$/u.test(version)) {
  refuse(`${manifestPath} names no major.minor.patch version`);
}

const lines = readFileSync(changelogPath, "utf-8").split("\n");
const top = lines.findIndex((line) => line.startsWith("## "));
const topLine = lines[top];
if (topLine === undefined) {
  refuse(`${changelogPath} has no section`);
}

const heading = topLine.slice("## ".length).trim();
if (!heading.startsWith(`${version} — `)) {
  refuse(
    `the top section of CHANGELOG.md is "${heading}", not this release: title it "${version} — <YYYY-MM-DD>" before releasing ${version}`,
  );
}

const next = lines.findIndex((line, index) => index > top && line.startsWith("## "));
const notes = lines
  .slice(top + 1, next === -1 ? lines.length : next)
  .join("\n")
  .trim();
if (notes === "") {
  refuse(`the ${version} section of CHANGELOG.md is empty`);
}

process.stdout.write(`${notes}\n`);
