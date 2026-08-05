import { defineConfig } from "@playwright/test";

// Headless smoke over the browser dev harness (`dev/`): the real renderer UI
// on the in-memory fixture Bridge — no Electron, no backend. This is the
// RUNTIME gate CI runs beside the static `pnpm verify`; locally it is
// `pnpm -F @repo/desktop test:e2e`.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  // One retry in CI only: the harness boots a wasm sqlite knowledge engine
  // per page load, and a cold CI runner can miss a first-paint deadline a
  // laptop never does. Locally a flake should FAIL so it gets fixed.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    // --strictPort: the dev scripts auto-increment when a port is taken, and
    // a harness that silently moved would leave this suite waiting on 5173
    // while a stale server answers with someone else's state. Fail instead.
    command: "pnpm dev:harness --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
