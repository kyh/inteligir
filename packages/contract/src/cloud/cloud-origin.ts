// what a client talks to when nothing names another origin; a second spelling in either client is
// how one of them ends up signing in somewhere the other does not.
export const PRODUCTION_CLOUD_ORIGIN = "https://inteligir.com";

// the origin the Mac app's page runs on: Tauri serves the bundled page under its own scheme, so
// every call the page makes to the cloud is cross-origin (`apps/web/src/worker/cors.ts`)
export const MAC_APP_ORIGIN = "tauri://localhost";
