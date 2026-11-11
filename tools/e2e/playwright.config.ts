import { defineConfig } from "@playwright/test";

const ci = process.env.CI !== undefined;

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: ci,
  reporter: ci ? "github" : "list",
  // a flaky flow is a bug to fix, not a run to repeat
  retries: 0,
  testDir: "src",
  timeout: 120_000,
  // the full Chromium in its new headless mode, the one that loads an extension
  use: { channel: "chromium", trace: "retain-on-failure" },
  workers: ci ? 2 : undefined,
});
