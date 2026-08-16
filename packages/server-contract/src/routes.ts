import {
  defineRoute,
  jsonResponse,
  noRequest,
  type ApiSchemaFromRouteDescriptors,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
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

export const systemStatusResponseSchema = z
  .object({
    /** Version of the running @repo/app package, read from its package.json. */
    version: z.string().min(1),
    /** Absolute path of the active data directory (where the DB lives). */
    dataDir: z.string().min(1),
    /** The `meta.schema_version` row — proves migrate-on-boot ran. */
    schemaVersion: z.number().int().min(1),
    uptimeMs: z.number().min(0),
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
  threads: threadRoutes,
  vault: vaultRoutes,
};

export type ApiSchema = ApiSchemaFromRouteDescriptors<typeof apiRoutes>;
