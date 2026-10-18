import { RPC_PREFIX } from "@repo/contract/local/routes";
import type { BootedTestApp } from "../../server/test-support/boot-app";
import { vi } from "vitest";

// the signal is dropped on purpose: jsdom's AbortSignal is not Node's and undici refuses it.
export const routePageFetch = (booted: BootedTestApp): void => {
  vi.stubGlobal(
    "fetch",
    async (input: string | URL, init?: RequestInit) =>
      await booted.request(String(input), { ...init, signal: null }),
  );
};

// the same route, counting the calls the page makes by procedure ("threads/get") as they leave
export const countPageCalls = (booted: BootedTestApp): ((procedure: string) => number) => {
  const calls = new Map<string, number>();
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const procedure = new URL(url, "http://localhost").pathname.slice(`${RPC_PREFIX}/`.length);
    calls.set(procedure, (calls.get(procedure) ?? 0) + 1);
    return await booted.request(url, { ...init, signal: null });
  });
  return (procedure) => calls.get(procedure) ?? 0;
};
