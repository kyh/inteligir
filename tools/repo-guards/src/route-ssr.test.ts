// ---------------------------------------------------------------------------
// Where `ssr` may be declared in apps/web's route tree.
//
// TanStack Router inherits the flag DOWNWARD, so `ssr` is a per-route fact and
// a parent that declares it has decided for children that never asked. That is
// the regression this pins: `ssr: false` on the `/app` layout makes the auth
// pages — a form and two `useState`s — client-only by inheritance, and a
// signed-out visitor watches a blank document until the bundle lands. It is one
// line, and nothing else in the repo notices.
//
// The other half is the reason the flag exists at all. The workspace mutates
// Plate's own editor nodes and `/app/link` reads `window.location` on the way
// up, so neither may EVER take a render pass on workerd. A guard that pinned
// only the layout could be satisfied by deleting those, so the client-only set
// is named below with its reason rather than derived — no tree walk can know
// which component survives a server render.
//
// Each rule below says what a NAMED set of routes must declare, so the last one
// is the closure: a route in none of those sets may not declare the flag at
// all. Without it every rule here is satisfied by `ssr: false` on the marketing
// page — the one route whose whole job is to render for a visitor who has never
// loaded this app.
//
// Textual, like the rest of this package. `apps/web` compiles under two tsconfig
// programs and its vitest project runs inside the Workers pool, where there is
// no filesystem to walk; and what is being read — which options a route module
// DECLARES — is exactly what the text says.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ROUTES_DIR = path.join(REPO_ROOT, "apps/web/src/routes");

/** Routes that cannot survive a render pass on workerd, and why. Membership is
 * the only licence to declare `ssr: false`. */
const CLIENT_ONLY = [
  { route: "/app/", why: "the workspace mutates Plate's own editor nodes" },
  { route: "/app/link", why: "the deep-link page reads window.location on the way up" },
];

/** The gate every OTHER session-guarded route declares: server-render precisely
 * the requests that carry no session cookie, where `currentSession`'s
 * server-side `null` is the truth rather than an artefact of the render. */
const SESSION_GATE = "ssrWhenSignedOut";

type RouteModule = {
  /** Repo-relative, for a failure that names the file to open. */
  file: string;
  /** The route's declared path; `""` for the root layout, which parents all. */
  route: string;
  /** The `ssr` option's source text, or null where the route declares none. */
  ssr: string | null;
  /** Whether its `beforeLoad` reads the session. */
  guarded: boolean;
};

const FILE_ROUTE = /createFileRoute\(\s*"([^"]+)"\s*\)/;
const ROOT_ROUTE = /createRootRoute\(/;
/** A whole line that IS the `ssr` property of a route's options object. Anchored
 * at oxfmt's two-space indent so a comment quoting `ssr: false` — and this
 * file's own header does — can never read as a declaration. */
const SSR_OPTION = /^ {2}ssr:\s*([^\n]*?),?$/m;

function moduleFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) moduleFiles(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
}

function readRoutes(): RouteModule[] {
  const files: string[] = [];
  moduleFiles(ROUTES_DIR, files);
  return files.map((file) => {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    const declared = FILE_ROUTE.exec(source)?.[1];
    if (declared === undefined && !ROOT_ROUTE.test(source)) {
      // Loud rather than skipped: a module this walk cannot read is a module
      // whose `ssr` placement nothing checks.
      throw new Error(`${relative} declares no route this guard can read`);
    }
    return {
      file: relative,
      route: declared ?? "",
      ssr: SSR_OPTION.exec(source)?.[1] ?? null,
      guarded: /\bcurrentSession\(/.test(source),
    };
  });
}

const ROUTES = readRoutes();

describe("apps/web route SSR", () => {
  it("no route with children declares ssr", () => {
    const parents = ROUTES.filter((route) =>
      ROUTES.some((other) => other.route.startsWith(`${route.route}/`)),
    );
    // A floor: the layouts are what this rule is about, so a tree with none of
    // them means the walk stopped seeing the shape rather than that it passed.
    expect(
      parents.map((route) => route.route),
      "no layout route found",
    ).toContain("/app");

    const declaring = parents
      .filter((route) => route.ssr !== null)
      .map((route) => `  ${route.file} (${route.route}) declares ssr: ${route.ssr}`);
    expect(
      declaring,
      "the flag inherits downward, so a layout decides for every child — declare\n" +
        `it on the routes that need it instead:\n${declaring.join("\n")}`,
    ).toEqual([]);
  });

  it("the routes that cannot render on workerd are client-only", () => {
    for (const { route, why } of CLIENT_ONLY) {
      const found = ROUTES.find((candidate) => candidate.route === route);
      expect(found, `${route} is gone — re-anchor this list, do not delete it`).toBeDefined();
      expect(found?.ssr, `${route} must declare ssr: false — ${why}`).toBe("false");
    }
  });

  it("every other session-guarded route is gated on the session cookie", () => {
    const clientOnly = new Set(CLIENT_ONLY.map((entry) => entry.route));
    const guarded = ROUTES.filter((route) => route.guarded && !clientOnly.has(route.route));
    // A floor: the guard is spotted by its call, so a renamed reader would empty
    // this set and pass over every route it should have held.
    expect(guarded.length, "no session-guarded route found").toBeGreaterThan(0);

    const ungated = guarded
      .filter((route) => route.ssr !== SESSION_GATE)
      .map((route) => `  ${route.file} (${route.route}) declares ssr: ${route.ssr}`);
    expect(
      ungated,
      `a guarded route reads a session the server cannot see, so it must declare\n` +
        `ssr: ${SESSION_GATE} — or join CLIENT_ONLY above with its reason:\n${ungated.join("\n")}`,
    ).toEqual([]);
  });

  it("no other route declares ssr at all", () => {
    // The closure over the three rules above, and the one that makes them a
    // POLICY rather than three spot checks: they each say what a named set of
    // routes must declare, and every one of them is satisfied by a route in
    // none of those sets declaring whatever it likes. `ssr: false` on the
    // marketing page is the shape that costs something — a blank document until
    // the bundle lands, on the one page whose whole job is to render for a
    // visitor who has never loaded this app.
    const clientOnly = new Set(CLIENT_ONLY.map((entry) => entry.route));
    const declaring = ROUTES.filter(
      (route) => route.ssr !== null && !clientOnly.has(route.route) && !route.guarded,
    ).map((route) => `  ${route.file} (${route.route}) declares ssr: ${route.ssr}`);

    expect(
      declaring,
      `ssr is a per-route decision with exactly two reasons in this app: a component\n` +
        `that cannot render on workerd (join CLIENT_ONLY with yours), or a session the\n` +
        `server cannot see (ssr: ${SESSION_GATE}). A route with neither renders on the\n` +
        `server, which is the default and the cheap one:\n${declaring.join("\n")}`,
    ).toEqual([]);
  });
});
