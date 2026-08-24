import {
  defineRoute,
  jsonResponse,
  noRequest,
  type ApiSchemaFromRouteDescriptors,
  type RouteDefinition,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import { cloudRoutes } from "./cloud";
import { connectorRoutes } from "./connectors";
import { folderRoutes } from "./folders";
import { noteIntelligenceRoutes } from "./note-intelligence";
import { commentRoutes } from "./comments";
import { knowledgeRoutes } from "./knowledge";
import { agentsRoutes } from "./agents";
import { proposalRoutes } from "./proposals";
import { threadRoutes } from "./threads";
import { vaultRoutes } from "./vault";
import { voiceRoutes } from "./voice";

/** Where the route table below is mounted; client and server both derive from it. */
export const API_BASE_PATH = "/api/v1";

/**
 * The path a route is SERVED at — the mount point plus the row's own path.
 *
 * The typed client composes this for itself, so callers that reach the server
 * any other way (a health probe, an `<img src>`, a scenario asserting a
 * request URL) had each written their own concatenation,
 * and several skipped the row entirely and spelled the whole path. Both halves
 * move: the mount point is a version prefix, and a row's path is edited in the
 * table below. One function so neither half can be half-derived.
 */
export function apiPath(route: RouteDefinition): string {
  return `${API_BASE_PATH}${route.path}`;
}

export const healthResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * What the boot-time driver resolution decided. `mode` is the configuration
 * (INTELIGIR_AGENT / config.json); `runtime` is what actually serves turns —
 * `unavailable` states the reason in `detail` (e.g. no codex binary on PATH)
 * so a 503 on send is diagnosable from status alone.
 */
export const agentStatusSchema = z
  .object({
    mode: z.enum(["auto", "codex", "scripted", "off"]),
    runtime: z.enum(["acp", "scripted", "unavailable", "off"]),
    detail: z.string().nullable(),
  })
  .strict();
export type AgentStatus = z.infer<typeof agentStatusSchema>;

/**
 * The built-in agent guide: a SKILL.md-shaped manual for the `inteligir` CLI,
 * served by the app so an agent (or a human) can always fetch the manual that
 * matches the running build. The CLI's `guide` command prints it.
 */
export const guideResponseSchema = z.object({ markdown: z.string().min(1) }).strict();
export type GuideResponse = z.infer<typeof guideResponseSchema>;

export const systemStatusResponseSchema = z
  .object({
    /** Version of the running @repo/app package, read from its package.json. */
    version: z.string().min(1),
    /** Absolute path of the active data directory (where the DB lives) —
     *  which instance answered. */
    dataDir: z.string().min(1),
    /** Absolute path of the vault this instance serves — the other half of
     *  the identity, and what a caller is actually about to write into. */
    vaultDir: z.string().min(1),
    /** The `meta.schema_version` row — proves migrate-on-boot ran. */
    schemaVersion: z.number().int().min(1),
    uptimeMs: z.number().min(0),
    agent: agentStatusSchema,
  })
  .strict();
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;

/**
 * THE route table. One row per endpoint, grouped by domain; handlers register
 * against a row (`get(apiRoutes.health, …)`), the client derives its surface
 * from the whole table, so adding an endpoint is one row plus one handler.
 */
export const apiRoutes = {
  health: defineRoute({
    path: "/health",
    method: "get",
    request: noRequest(),
    response: jsonResponse<HealthResponse>(),
  }),
  system: {
    status: defineRoute({
      path: "/system/status",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemStatusResponse>(),
    }),
  },
  guide: defineRoute({
    path: "/guide",
    method: "get",
    request: noRequest(),
    response: jsonResponse<GuideResponse>(),
  }),
  cloud: cloudRoutes,
  connectors: connectorRoutes,
  folders: folderRoutes,
  noteIntelligence: noteIntelligenceRoutes,
  comments: commentRoutes,
  knowledge: knowledgeRoutes,
  agents: agentsRoutes,
  proposals: proposalRoutes,
  threads: threadRoutes,
  vault: vaultRoutes,
  voice: voiceRoutes,
};

export type ApiSchema = ApiSchemaFromRouteDescriptors<typeof apiRoutes>;
