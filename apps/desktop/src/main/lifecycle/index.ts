export { registerStartup, runStartup, resetStartup } from "./startup";
export type { StartupHook } from "./startup";

export { registerShutdown, runShutdown, resetShutdown } from "./shutdown";
export type { ShutdownHook } from "./shutdown";

export { registerSetup, runSetup, resetSetup } from "./setup";
export type { SetupStep, SetupResult } from "./setup";
