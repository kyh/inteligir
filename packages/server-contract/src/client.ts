// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { Hono } from "hono";
import { hc } from "hono/client";
import type { BlankEnv } from "hono/types";
import { API_BASE_PATH, type ApiSchema } from "./routes";

export type ApiRoutes = Hono<BlankEnv, ApiSchema>;

/** Omit the options to use global fetch; provide one to dial an in-process
 *  Hono app (`app.request`) instead of a listening socket. */
export interface ApiClientOptions {
  fetch: typeof fetch;
}

export function createApiClient(baseUrl: string, options?: ApiClientOptions) {
  return hc<ApiRoutes>(
    `${baseUrl}${API_BASE_PATH}`,
    options === undefined ? undefined : { fetch: options.fetch },
  );
}

export type ApiClient = ReturnType<typeof createApiClient>;
