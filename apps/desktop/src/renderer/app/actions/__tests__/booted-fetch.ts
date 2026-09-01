// The renderer's real oRPC client resolves `globalThis.fetch` per call, so a
// jsdom suite can answer it from a booted in-process app: stub fetch to hand
// every request to `booted.request`, which attaches the boot's own bearer.
// The surfaces under test then run against the server's real refusals rather
// than a mock of them.

import { QueryClient } from "@tanstack/react-query";
import type { BootedTestApp } from "inteligir/server/testing";
import { vi } from "vitest";

/** Route the renderer's fetch into the booted app. `String(input)` covers
 *  both spellings oRPC's fetch client dials with (a URL object or its href).
 *  The signal is dropped on purpose: jsdom's AbortSignal is not Node's,
 *  undici refuses the foreign instance, and nothing in these suites cancels. */
export function routeRendererFetch(booted: BootedTestApp): void {
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) =>
    booted.request(String(input), { ...init, signal: null }),
  );
}

/** No retries: a refused read must settle as the failure the surface renders,
 *  not spin the suite through the default backoff. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}
