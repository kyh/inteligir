// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { Hono } from "hono";
import { hc } from "hono/client";
import type { BlankEnv } from "hono/types";
import type { ApiSchema } from "./routes";

export type ApiRoutes = Hono<BlankEnv, ApiSchema>;

/** Omit the options object to use global fetch; provide it to override fetch. */
export interface ApiClientOptions {
  fetch: typeof fetch;
}

export function createApiClient(baseUrl: string, options?: ApiClientOptions) {
  return hc<ApiRoutes>(
    `${baseUrl}/api/v1`,
    options === undefined ? undefined : { fetch: options.fetch },
  );
}

export type ApiClient = ReturnType<typeof createApiClient>;
