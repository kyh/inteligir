import { Type } from "@sinclair/typebox";

import { isRecord } from "@/shared/ipc";
import { shellSchema } from "@/shared/shell";

// On-disk variant of the shared shell schema (shared/shell.ts owns the shape
// definitions). WidgetSpec is validated via parseWidgetSpec (TypeBox + cycle
// check) at the boundary that produces it (install/update/patch in shell.ts).
// Each custom def's `spec` is kept as Unknown here so a malformed spec on
// disk doesn't reject the whole shell — consumers parseWidgetSpec it on
// access.
export const ShellSchema = shellSchema(Type.Unknown());

// ---------------------------------------------------------------------------
// v2 → v3 migration: executor 1.4 → 1.5 tool readdressing.
//
// Executor 1.4 addressed tools as `<integration>.<tool…>`; 1.5's connections
// model addresses them as `<integration>.<owner>.<connection>.<tool…>`, and
// for Google Discovery integrations the trailing tool path changed from the
// Discovery method id MINUS its api-name prefix (`events.list`) to the full
// id (`calendar.events.list`). Widget specs persist these addresses in their
// callTool actions, so without a rewrite every pre-1.5 dashboard panel keeps
// dialing dead v1 paths and stays empty even after the user reconnects.
//
// The rewrite is mechanical and deliberately conservative — a wrong rewrite
// is worse than a stale one, so anything not confidently old-style v1 is
// left untouched (it fails at call time exactly like it already did).
// ---------------------------------------------------------------------------

/** v1.5 owner segment values. A second segment matching one of these marks an
 * address as already connection-scoped (or as an old address we cannot tell
 * apart from one — ambiguity means hands off). */
const OWNER_SEGMENTS = new Set(["user", "org"]);

/** First segments of executor core tool paths that are NOT connection-scoped
 * in 1.5 (`describe.tool`, `executor.coreTools.*`) — rewriting these would
 * break a working address. */
const CORE_TOOL_NAMESPACES = new Set(["describe", "executor"]);

/** Google Discovery api name per curated connector slug (the discovery URLs
 * in connector-catalog.ts). v1 google-discovery addresses dropped the
 * api-name prefix of the Discovery method id; v1.5 keeps the full id, so the
 * rewrite re-inserts it after the owner/connection segments. */
const GOOGLE_DISCOVERY_API_BY_SLUG = new Map<string, string>([
  ["gmail", "gmail"],
  ["google_calendar", "calendar"],
  ["google_drive", "drive"],
  ["google_docs", "docs"],
  ["google_sheets", "sheets"],
  ["google_contacts", "people"],
]);

/** Rewrite one v1 tool address to its 1.5 connection-scoped form under the
 * connection our connectors flow mints (owner "user", name "default" —
 * connector-install.ts DEFAULT_CONNECTION_NAME). Returns the input unchanged
 * when it is not confidently an old-style address. */
function migrateToolAddress(address: string): string {
  const segments = address.split(".");
  const [integration, second] = segments;
  // Not a two-plus-segment dotted path (or has an empty segment): never a
  // valid v1 widget-callable address — leave it for the call-time validator.
  if (integration === undefined || second === undefined || segments.includes("")) return address;
  if (OWNER_SEGMENTS.has(second)) return address;
  if (CORE_TOOL_NAMESPACES.has(integration)) return address;
  const rest = segments.slice(1);
  const apiName = GOOGLE_DISCOVERY_API_BY_SLUG.get(integration);
  return apiName === undefined
    ? [integration, "user", "default", ...rest].join(".")
    : [integration, "user", "default", apiName, ...rest].join(".");
}

/** Rewrite `params.tool` on a callTool action request. Dynamic tool values
 * (e.g. `{ $state: '/path' }`) are left alone — state is user data and there
 * is no mechanical way to tell an address from a lookalike string. */
function migrateActionRequest(raw: unknown): unknown {
  if (!isRecord(raw) || raw["action"] !== "callTool") return raw;
  const params = raw["params"];
  if (!isRecord(params)) return raw;
  const tool = params["tool"];
  if (typeof tool !== "string") return raw;
  const migrated = migrateToolAddress(tool);
  if (migrated === tool) return raw;
  return { ...raw, params: { ...params, tool: migrated } };
}

/** An `on`/`watch` binding value: one action request or an array of them. */
function migrateActionBinding(raw: unknown): unknown {
  return Array.isArray(raw) ? raw.map(migrateActionRequest) : migrateActionRequest(raw);
}

// Object.fromEntries (not key assignment) so a JSON-parsed "__proto__" own
// property stays a data property instead of hitting the prototype setter.
function migrateBindingMap(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, migrateActionBinding(value)]),
  );
}

/** Walk the three places a spec can hold action requests: `onMount`, and each
 * element's `on` / `watch` maps. Everything else (including `state` and
 * archived instance state, which hold user data, not addresses) passes
 * through untouched, preserving key order. */
function migrateSpec(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const next: Record<string, unknown> = { ...raw };
  const onMount = raw["onMount"];
  if (Array.isArray(onMount)) next["onMount"] = onMount.map(migrateActionRequest);
  const elements = raw["elements"];
  if (isRecord(elements)) {
    next["elements"] = Object.fromEntries(
      Object.entries(elements).map(([key, element]) => {
        if (!isRecord(element)) return [key, element];
        const nextElement: Record<string, unknown> = { ...element };
        if (element["on"] !== undefined) nextElement["on"] = migrateBindingMap(element["on"]);
        if (element["watch"] !== undefined) {
          nextElement["watch"] = migrateBindingMap(element["watch"]);
        }
        return [key, nextElement];
      }),
    );
  }
  return next;
}

function migrateDef(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const source = raw["source"];
  if (!isRecord(source) || source["spec"] === undefined) return raw;
  return { ...raw, source: { ...source, spec: migrateSpec(source["spec"]) } };
}

/**
 * v2 → v3: bump the version field and rewrite every custom def spec's
 * callTool addresses from executor 1.4's `<integration>.<tool…>` scheme to
 * 1.5's connection-scoped `<integration>.user.default.<tool…>`. The wire
 * format is otherwise unchanged — instances, archivedStates, and key order
 * all pass through as-is. Runs pre-validation, so every step is defensive:
 * an unexpected shape is passed along for the schema check to judge.
 */
export function migrateShellV2ToV3(raw: unknown): unknown {
  if (!isRecord(raw)) {
    throw new Error("shell v2 migration expected an object");
  }
  const customDefs = raw["customDefs"];
  return {
    ...raw,
    version: 3,
    ...(Array.isArray(customDefs) ? { customDefs: customDefs.map(migrateDef) } : {}),
  };
}
