// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { Hono } from "hono";
import { hc } from "hono/client";
import type { BlankEnv } from "hono/types";
import { API_BASE_PATH, type ApiSchema } from "./routes";

export type ApiRoutes = Hono<BlankEnv, ApiSchema>;

export function createApiClient(baseUrl: string) {
  return hc<ApiRoutes>(`${baseUrl}${API_BASE_PATH}`);
}

export type ApiClient = ReturnType<typeof createApiClient>;
