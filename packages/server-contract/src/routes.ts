import {
  defineRoute,
  jsonResponse,
  noRequest,
  type ApiSchemaFromRouteDescriptors,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import { knowledgeRoutes } from "./knowledge";
import { threadRoutes } from "./threads";
import { vaultRoutes } from "./vault";

/** Where the route table below is mounted; client and server both derive from it. */
export const API_BASE_PATH = "/api/v1";

export const healthResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Every non-2xx API body. `error` is a stable machine-readable class
 * (`invalid_request`, `forbidden_origin`, `not_found`, `internal`);
 * `message` is safe for display — internals never reach it.
 */
export const apiErrorResponseSchema = z
  .object({
    error: z.string().min(1),
    message: z.string(),
  })
  .strict();
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/**
 * What the boot-time driver resolution decided. `mode` is the configuration
 * (INTELIGIR_AGENT / config.json); `runtime` is what actually serves turns —
 * `unavailable` states the reason in `detail` (e.g. no codex binary on PATH)
 * so a 503 on send is diagnosable from status alone.
 */
export const agentStatusSchema = z
  .object({
    mode: z.enum(["auto", "codex", "scripted", "off"]),
    runtime: z.enum(["codex", "scripted", "unavailable", "off"]),
    detail: z.string().nullable(),
  })
  .strict();
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const systemStatusResponseSchema = z
  .object({
    /** Version of the running @repo/app package, read from its package.json. */
    version: z.string().min(1),
    /** Absolute path of the active data directory (where the DB lives). */
    dataDir: z.string().min(1),
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
  knowledge: knowledgeRoutes,
  threads: threadRoutes,
  vault: vaultRoutes,
};

export type ApiSchema = ApiSchemaFromRouteDescriptors<typeof apiRoutes>;
