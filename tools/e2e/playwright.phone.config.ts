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
