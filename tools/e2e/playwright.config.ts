import { defineConfig } from "@playwright/test";

const ci = process.env.CI !== undefined;

// what Playwright's other engines stand in for: WebKit for Safari and the Mac app's engine, never
// its window, and Firefox for Firefox. An extension loads only in Chromium.
const standIn = (browserName: "firefox" | "webkit") => ({
  name: browserName,
  testIgnore: "extension.spec.ts",
  use: { browserName },
});

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: ci,
  // the run's template database, pushed once and dropped as the run ends
  globalSetup: "./src/databases.ts",
  reporter: ci ? "github" : "list",
  // a flaky flow is a bug to fix, not a run to repeat
  retries: 0,
  projects: [
    // the full Chromium in its new headless mode, the one that loads an extension
    { name: "chromium", use: { channel: "chromium" } },
    standIn("webkit"),
    standIn("firefox"),
  ],
  testDir: "src",
  timeout: 120_000,
  use: { trace: "retain-on-failure" },
  workers: ci ? 2 : undefined,
});
