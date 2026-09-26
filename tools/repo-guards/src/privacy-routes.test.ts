// docs/privacy.md promises a row for every address the app talks to, and the cloud contract is
// what every client dials. Read from both, a route cannot reach the wire without the page saying
// what it carries, and a deleted one cannot linger there.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTestFile, REPO_ROOT, sourceOf, trackedFiles } from "./repo";

const PRIVACY = "docs/privacy.md";
const APPENDIX_HEADING = "## Every address the app talks to";
const CONTRACT_DIR = "packages/api/src/cloud/";

const ROUTE_LITERAL = /(?<quote>["'`])(?<route>\/v1\/[^"'`\s]+)\k<quote>/gu;
const DOCUMENTED_ROUTE = /`(?<route>\/v1\/[^`\s]+)`/gu;

const routesIn = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].flatMap((match) => {
    const route = match.groups?.route;
    return route === undefined ? [] : [route];
  });

const appendixOf = (privacy: string): string | null => {
  const lines = privacy.split("\n");
  const heading = lines.indexOf(APPENDIX_HEADING);
  if (heading === -1) {
    return null;
  }
  const rest = lines.slice(heading + 1);
  const next = rest.findIndex((line) => line.startsWith("## "));
  return (next === -1 ? rest : rest.slice(0, next)).join("\n");
};

// the contract as file → source, so the checker judges text and a test can hand it any tree
const privacyRouteDrift = (contract: ReadonlyMap<string, string>, privacy: string): string[] => {
  const appendix = appendixOf(privacy);
  if (appendix === null) {
    return [
      `NO ADDRESS APPENDIX  ${PRIVACY}\n` +
        `  rule: ${PRIVACY} carries "${APPENDIX_HEADING}", one row per /v1 route the cloud contract declares\n` +
        `  fix: restore the section, with a backticked route in each row`,
    ];
  }
  const documented = new Set(routesIn(appendix, DOCUMENTED_ROUTE));
  const declared = new Map<string, string>();
  for (const [file, source] of contract) {
    for (const route of routesIn(source, ROUTE_LITERAL)) {
      if (!declared.has(route)) {
        declared.set(route, file);
      }
    }
  }
  const undocumented = [...declared]
    .filter(([route]) => !documented.has(route))
    .map(
      ([route, file]) =>
        `UNDOCUMENTED ROUTE  ${route}\n` +
        `  declared in: ${file}\n` +
        `  rule: every /v1 route the cloud contract declares has a row under "${APPENDIX_HEADING}" in ${PRIVACY} saying what it carries and what authenticates it\n` +
        `  fix: add a row naming \`${route}\` to ${PRIVACY}`,
    );
  const stale = [...documented]
    .filter((route) => !declared.has(route))
    .map(
      (route) =>
        `STALE ROW  ${route}\n` +
        `  in: ${PRIVACY}\n` +
        `  rule: a row under "${APPENDIX_HEADING}" names a route some file under ${CONTRACT_DIR} still declares; the page must not promise an address the app no longer talks to\n` +
        `  fix: delete the row, or correct its route to the one the contract spells`,
    );
  return [...undocumented, ...stale];
};

const contractSources = (): Map<string, string> =>
  new Map(
    trackedFiles()
      .filter((file) => file.startsWith(CONTRACT_DIR) && file.endsWith(".ts") && !isTestFile(file))
      .toSorted()
      .map((file) => [file, sourceOf(file)]),
  );

const readPrivacy = (): string => fs.readFileSync(path.join(REPO_ROOT, PRIVACY), "utf-8");

describe("docs/privacy.md names every /v1 route the cloud contract declares", () => {
  it("finds the contract's routes and the appendix", () => {
    const routes = [...contractSources().values()].flatMap((source) =>
      routesIn(source, ROUTE_LITERAL),
    );
    expect(
      routes.length,
      `no /v1 literal under ${CONTRACT_DIR} — the sweep is broken, not the tree`,
    ).toBeGreaterThan(0);
    expect(appendixOf(readPrivacy()), `${PRIVACY} has no "${APPENDIX_HEADING}"`).not.toBeNull();
  });

  it("holds a row for every declared route, and no row for any other", () => {
    const drift = privacyRouteDrift(contractSources(), readPrivacy());
    expect(drift, `\n${drift.join("\n\n")}\n`).toEqual([]);
  });

  it("refuses an undocumented route and a stale row, naming each", () => {
    const contract = new Map([
      ["a/a-schema.ts", 'export const A = { kept: "/v1/kept", new: "/v1/new" };'],
    ]);
    const privacy = [
      "# Privacy",
      "",
      APPENDIX_HEADING,
      "",
      "| `/v1/kept` | it | a credential |",
      "| `/v1/gone` | it | a credential |",
      "",
      "## Later",
      "",
      "`/v1/new` outside the appendix does not count.",
    ].join("\n");
    const drift = privacyRouteDrift(contract, privacy);
    expect(drift).toHaveLength(2);
    expect(drift[0]).toContain("UNDOCUMENTED ROUTE  /v1/new");
    expect(drift[0]).toContain("a/a-schema.ts");
    expect(drift[1]).toContain("STALE ROW  /v1/gone");
    expect(privacyRouteDrift(contract, "# Privacy\n")[0]).toContain("NO ADDRESS APPENDIX");
  });
});
