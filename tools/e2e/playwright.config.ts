import { defineConfig } from "@playwright/test";

const ci = process.env.CI !== undefined;

const standIn = (browserName: "firefox" | "webkit") => ({
  name: browserName,
  testIgnore: "extension.test.ts",
  use: { browserName },
});

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: ci,
  globalSetup: "./src/databases.ts",
  reporter: ci ? "github" : "list",
  retries: 0,
  projects: [
    { name: "chromium", use: { channel: "chromium" } },
    standIn("webkit"),
    standIn("firefox"),
  ],
  testDir: "src",
  timeout: 120_000,
  use: { trace: "retain-on-failure" },
  workers: ci ? 2 : undefined,
});
