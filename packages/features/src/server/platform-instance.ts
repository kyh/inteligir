// ---------------------------------------------------------------------------
// The process-wide platform/options installed by createHost(). Host modules
// are module-level singletons (one host per process — see create-host.ts), so
// the platform they act through is module-level too; threading it through
// every getter would churn the whole call graph for zero flexibility gain.
// ---------------------------------------------------------------------------

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
