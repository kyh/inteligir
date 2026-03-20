// Re-export from agent sidecar setup — shared between main process and worker
export {
  Agent,
  isLoggedIn,
  isSetupComplete,
  login,
  seedResources,
  teardownResources,
} from "@/agent/setup";
