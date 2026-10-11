import type { BootedTestApp } from "../../server/__tests__/boot-app";
import { vi } from "vitest";

// the signal is dropped on purpose: jsdom's AbortSignal is not Node's and undici refuses it.
export const routePageFetch = (booted: BootedTestApp): void => {
  vi.stubGlobal(
    "fetch",
    async (input: string | URL, init?: RequestInit) =>
      await booted.request(String(input), { ...init, signal: null }),
  );
};
