// the sweep is what the repo contains, not what it ships: smoke scripts in scripts/ are the callers
// that drift. tests are excluded on purpose: a route test that derived its URL from the contract
// could not catch the contract moving.

import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { DOOR_ROUTES } from "@repo/service/door-routes";
import { describe, expect, it } from "vitest";
import { isTestFile, sourceOf, workspaceSourceFiles, workspaces } from "./repo";

// a `quoted` path is a word module paths hold too (`@repo/contract/library/…`), so it counts only
// where a string or a route pattern starts with it.
interface Namespace {
  readonly home: string;
  readonly paths: readonly string[];
  readonly use: string;
  readonly quoted?: boolean;
}

const NAMESPACES: readonly Namespace[] = [
  {
    home: "packages/contract/src/v1-contract.ts",
    paths: [V1_RPC_PATH],
    use: "V1_RPC_PATH from @repo/contract/v1",
  },
  {
    home: "packages/contract/src/library-page.ts",
    paths: [LIBRARY_PAGE_PATH],
    quoted: true,
    use: "LIBRARY_PAGE_PATH from @repo/contract/library-page",
  },
];

// longest first, so a path is matched before any shorter one it contains
const GUARDED = NAMESPACES.flatMap((namespace) =>
  namespace.paths.map((path) => ({
    home: namespace.home,
    path,
    quoted: namespace.quoted === true,
    use: namespace.use,
  })),
).toSorted((left, right) => right.path.length - left.path.length);

// a caller that cannot import the contract, keyed by file, with why it cannot
const ELSEWHERE = new Map([
  [
    "apps/web/cloudflare.config.ts",
    "its runWorkerFirst patterns: the dev server cannot load a module the config and the Worker both load (oxlint.config.ts, CONFIG_MODULES)",
  ],
]);

interface Spelled {
  path: string;
  quoted: boolean;
  home: string;
  use: string;
}

interface Hit extends Spelled {
  file: string;
}

// not followed by a word character or a dash, which tells `"/library?item="` from `"/library-page"`
const spells = (source: string, { path, quoted }: Pick<Spelled, "path" | "quoted">): boolean =>
  new RegExp(`${quoted ? "[\"'`!]" : ""}${path}(?![\\w-])`, "u").test(source);

const spellings = (source: string): Spelled[] =>
  GUARDED.filter((row) => spells(source, row)).slice(0, 1);

const sweptFiles = (): string[] =>
  workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isTestFile(file))
    .toSorted();

// Start's file routes, each spelling its id as its path, which the router's generator holds it to
const ROUTES_DIR = "apps/web/src/routes/";
const ROUTE_ID = /createFileRoute\(\s*"(?<id>[^"]+)"\s*\)/u;
const DOOR_CALL = /\bcontext\.doors\.(?<door>\w+)\b/gu;
// the whole handler: a door answers every method itself, and a method a route left out would fall
// to the site's page, a 200 of HTML
const DOOR_HANDLER =
  /^\s*ANY: async \(\{ request, context \}\) => await context\.doors\.(?<door>\w+)\(request\),$/mu;

interface RouteFile {
  readonly file: string;
  readonly id: string | undefined;
  readonly doors: readonly string[];
  readonly handler: string | undefined;
}

const routeFiles = (files: readonly string[]): RouteFile[] =>
  files
    .filter((file) => file.startsWith(ROUTES_DIR))
    .map((file) => {
      const source = sourceOf(file);
      return {
        doors: [...source.matchAll(DOOR_CALL)].map((match) => match.groups?.door ?? ""),
        file,
        handler: DOOR_HANDLER.exec(source)?.groups?.door,
        id: ROUTE_ID.exec(source)?.groups?.id,
      };
    });

const DOOR_IDS = new Set<string>(Object.values(DOOR_ROUTES));

// a door's route spells the contract's path by its id, which the table derives from the contract,
// and a generated file spells whatever its input did
const heldElsewhere = (file: string, routes: readonly RouteFile[]): boolean =>
  file.endsWith(".gen.ts") ||
  routes.some((route) => route.file === file && route.id !== undefined && DOOR_IDS.has(route.id));

const hits = (files: readonly string[]): Hit[] =>
  files.flatMap((file) => spellings(sourceOf(file)).map((row) => ({ ...row, file })));

describe("one spelling per non-procedure route path", () => {
  const files = sweptFiles();

  it("finds every home and the tree they are held against", () => {
    for (const row of GUARDED) {
      expect(row.path.startsWith("/"), `not a path: "${row.path}"`).toBe(true);
    }
    expect(
      files,
      "the sweep does not reach scripts/, which is where the smokes that spell paths live",
    ).toContain("apps/desktop/scripts/smoke-packaged.ts");
    for (const namespace of NAMESPACES) {
      expect(files, `the sweep found no ${namespace.home} — it is broken, not the tree`).toContain(
        namespace.home,
      );
      expect(spellings(sourceOf(namespace.home))).toHaveLength(1);
    }
  });

  it("nothing outside the contract writes one as a literal", () => {
    const routes = routeFiles(files);
    const violations: string[] = [];
    for (const hit of hits(files)) {
      if (hit.file === hit.home) {
        continue;
      }
      if (ELSEWHERE.has(hit.file) || heldElsewhere(hit.file, routes)) {
        continue;
      }
      violations.push(
        `HAND-SPELLED ROUTE PATH  ${hit.file}\n` +
          `  found: the literal "${hit.path}…"\n` +
          `  rule: every path a server answers outside its RPC handler lives in ${hit.home}; a caller holding its own copy keeps dialing the old one after it moves, and finds out at runtime\n` +
          `  fix: use ${hit.use} — or add a row to ELSEWHERE in tools/repo-guards/src/route-paths.test.ts saying why this caller cannot import the contract`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toStrictEqual([]);
  });

  it("no ELSEWHERE row is stale", () => {
    const matched = new Set(hits(files).map((hit) => hit.file));
    const stale = [...ELSEWHERE]
      .filter(([file]) => !matched.has(file))
      .map(
        ([file, why]) =>
          `STALE EXCEPTION  ${file}\n` +
          `  it no longer spells a route path, so the reason it carried is spent\n` +
          `  the reason was: ${why}\n` +
          `  fix: delete the row from ELSEWHERE in tools/repo-guards/src/route-paths.test.ts`,
      );
    expect(stale, `\n${stale.join("\n\n")}\n`).toStrictEqual([]);
  });
});

describe("every door is one Start route and one row of the service's table", () => {
  const routes = routeFiles(sweptFiles());
  const table = Object.entries(DOOR_ROUTES);

  it("finds the routes and the table it holds them to", () => {
    expect(
      routes.map((route) => route.file),
      `the sweep found no route file under ${ROUTES_DIR} — it is broken, not the tree`,
    ).toContain(`${ROUTES_DIR}index.tsx`);
    expect(table.length).toBeGreaterThan(0);
  });

  it("each row is one route file, which hands every method to its door", () => {
    const violations = table.flatMap(([door, id]) => {
      const answering = routes.filter((route) => route.id === id);
      const [only] = answering;
      if (answering.length !== 1 || only === undefined) {
        const found =
          answering.length === 0
            ? "no route file"
            : answering.map((route) => route.file).join(", ");
        return [
          `DOOR WITHOUT ONE ROUTE  ${door} (${id})\n` +
            `  found: ${found}\n` +
            `  rule: Start answers a path only through a file route, so each row of @repo/service/door-routes is exactly one file under ${ROUTES_DIR}\n` +
            `  fix: add the route at the file path its id names, its handler \`ANY: async ({ request, context }) => await context.doors.${door}(request),\``,
        ];
      }
      if (only.handler === door && only.doors.length === 1) {
        return [];
      }
      const found =
        only.handler === undefined
          ? `no ANY handler; doors called: ${only.doors.join(", ") || "none"}`
          : `context.doors.${only.handler}`;
      return [
        `DOOR ROUTE NOT ITS DOOR'S  ${only.file}\n` +
          `  found: ${found}\n` +
          `  rule: the route for ${id} hands every method to the ${door} door, which answers its methods and its 405 itself; a method the route leaves out falls to the site's page\n` +
          `  fix: make its one handler \`ANY: async ({ request, context }) => await context.doors.${door}(request),\``,
      ];
    });
    expect(violations, `\n${violations.join("\n\n")}\n`).toStrictEqual([]);
  });

  it("no route reaches a door its id is not the row of", () => {
    const violations = routes
      .filter((route) => route.doors.length > 0)
      .filter(
        (route) =>
          !table.some(
            ([door, id]) => route.id === id && route.doors.every((each) => each === door),
          ),
      )
      .map(
        (route) =>
          `STRAY DOOR CALL  ${route.file}\n` +
          `  found: route ${route.id ?? "(no id)"} calls context.doors.${route.doors.join(", context.doors.")}\n` +
          `  rule: a door answers only the path its row in @repo/service/door-routes names, and refuses any other\n` +
          `  fix: route the path to the door its row names, or add the row`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toStrictEqual([]);
  });
});
