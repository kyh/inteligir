// The phone's flows, apart from `playwright.config.ts` so `pnpm e2e` never needs a Mac: one worker,
// since there is one simulator, whose app listens where the phone's build reaches (`phone/simulator.ts`).

import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: process.env.CI !== undefined,
  globalSetup: "./src/databases.ts",
  reporter: "list",
  retries: 0,
  testDir: "phone",
  timeout: 300_000,
  use: { trace: "retain-on-failure" },
  workers: 1,
});
