// ---------------------------------------------------------------------------
// The process-wide platform/options installed by createHost(). Host modules
// are module-level singletons (one host per process — see boot/create-host.ts), so
// the platform they act through is module-level too; threading it through
// every getter would churn the whole call graph for zero flexibility gain.
// ---------------------------------------------------------------------------

import { isHttpUrl } from "@repo/bridge/wire-helpers";

import type { HostOptions, HostPlatform } from "./platform";

let platform: HostPlatform | null = null;
let options: HostOptions = {};

export function installHostRuntime(nextPlatform: HostPlatform, nextOptions: HostOptions): void {
  platform = nextPlatform;
  options = nextOptions;
}

export function getPlatform(): HostPlatform {
  if (!platform) throw new Error("Host platform not installed — createHost() has not run");
  return platform;
}

export function getHostOptions(): HostOptions {
  return options;
}

/** The ONE guarded browser-open path: refuses non-http(s) URLs (a custom
 * scheme handed to the OS opener could invoke an arbitrary protocol handler),
 * then defers to the installed platform's openExternal. Every host surface
 * that opens a URL a peer supplied — provider OAuth (agent/auth login),
 * sync's coordinator-supplied social sign-in URL, connector OAuth consent —
 * routes through this instead of growing its own opener. */
export async function openExternalHttpUrl(url: string): Promise<void> {
  if (!isHttpUrl(url)) throw new Error(`refusing to open non-http URL: ${url}`);
  await getPlatform().openExternal(url);
}
