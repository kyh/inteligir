// ---------------------------------------------------------------------------
// Route-table completeness: the contract's table against the composed app's
// registered routes, both directions.
//
// `typedRoutes` enforces a handler against its ROW at compile time, which is
// the half TypeScript can do. The half it cannot: whether the row was
// registered at all. A row nobody registers is not a compile error anywhere —
// the client derives its surface from the table, so `client.threads.delete.
// $post()` typechecks, ships, and answers 404 from the api catch-all. That is
// the class the deleted `collectHandlers` guard killed by throwing at
// construction; a Hono app has no such construction step, so the guard is a
// walk of `app.routes` instead.
//
// Both directions matter. A row with no handler is a promise the wire breaks;
// a handler with no row is a surface the client cannot reach and the contract
// does not describe.
// ---------------------------------------------------------------------------

import { API_BASE_PATH, apiRoutes } from "@repo/server-contract/routes";
import type { RouteDefinition } from "@repo/typed-routes/route-descriptor";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bootTestApp } from "./boot-app";

/** The table is a nested object of rows; identify one structurally, so a new
 *  domain group is walked with no edit here. `looseObject` keeps the row's
 *  other members, which is what makes the walk below a walk and not a rewrite. */
const routeDefinitionSchema = z.looseObject({
  path: z.string(),
  method: z.enum(["get", "post", "patch", "delete", "put"]),
  request: z.looseObject({}),
  response: z.unknown(),
});

/** A group in the table: anything that is not a row is walked into. */
interface RouteTableGroup {
  readonly [name: string]: RouteTableNode;
}

/** One node of the nested table — a row, or a group of them. */
type RouteTableNode = RouteDefinition | RouteTableGroup;

/** `GET /api/v1/vault/file` — method and path together, because `/vault/file`
 *  is two rows (read and write) and either can go missing alone. */
function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function flattenRouteTable(
  node: RouteTableNode,
  out: Map<string, string[]>,
  trail: string[],
): void {
  const row = routeDefinitionSchema.safeParse(node);
  if (row.success) {
    out.set(key(row.data.method, `${API_BASE_PATH}${row.data.path}`), trail);
    return;
  }
  for (const [name, child] of Object.entries(node)) {
    flattenRouteTable(child, out, [...trail, name]);
  }
}

describe("the API route table", () => {
  const declared = new Map<string, string[]>();
  flattenRouteTable(apiRoutes, declared, ["apiRoutes"]);

  it("flattens to the rows the contract declares", () => {
    // A flatten that returned nothing would pass both directions below.
    expect(declared.size, "flattenRouteTable found no rows in apiRoutes").toBeGreaterThan(0);
    expect(declared.has(key("get", `${API_BASE_PATH}/health`))).toBe(true);
  });

  it("registers a handler for every row, and no route without one", async () => {
    const booted = await bootTestApp();
    const registered = new Set(
      booted.composed.app.routes
        // `ALL /api/v1/*` is the origin guard and the not-found catch-all —
        // middleware, not a leaf, and the reason a missing row 404s quietly.
        .filter(
          (route) =>
            route.method !== "ALL" &&
            route.path.startsWith(API_BASE_PATH) &&
            !route.path.includes("*"),
        )
        .map((route) => key(route.method, route.path)),
    );

    const violations: string[] = [];
    for (const [row, trail] of declared) {
      if (registered.has(row)) continue;
      violations.push(
        `UNREGISTERED ROW  ${row}\n` +
          `  declared at ${trail.join(".")} (packages/server-contract)\n` +
          `  rule: every row in the route table has a handler; an unregistered one answers 404 from the api catch-all while the typed client still offers it`,
      );
    }
    for (const route of registered) {
      if (declared.has(route)) continue;
      violations.push(
        `UNDECLARED ROUTE  ${route}\n` +
          `  rule: every registered route is a row in packages/server-contract's table; a route outside it is unreachable from the typed client and undescribed by the contract`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
