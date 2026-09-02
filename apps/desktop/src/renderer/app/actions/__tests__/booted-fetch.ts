import type { BootedTestApp } from "inteligir/server/testing";
import { vi } from "vitest";

// the signal is dropped on purpose: jsdom's AbortSignal is not Node's and undici refuses it.
export function routeRendererFetch(booted: BootedTestApp): void {
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) =>
    booted.request(String(input), { ...init, signal: null }),
  );
}
