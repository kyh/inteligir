import { defineConfig } from "@playwright/test";

const ci = process.env.CI !== undefined;

// The flows the app on Next does not run yet, each leaving as its area lands: a file whole, or a
// test by its title.
const PENDING_FILES = ["saving.spec.ts"];
const PENDING_TESTS = [
  // each lands in the library tab
  "the site's sign-up spends its invite, and a signed-out tab signs in and comes back",
  "Settings waits offline, ends another device, turns the agent off, signs out and deletes",
  // each waits on the filing rules' rows (packages/service/src/rpc/unrouted.test.ts)
  "the filing rules start from the starter's and save, and Tidy my library files from Unsorted",
];

// a title, its every character literal, as Playwright's grep finds it in a test's full title
const titled = (title: string): RegExp =>
  new RegExp(title.replaceAll(/[$()*+./?[\\\]^{|}]/gu, String.raw`\$&`), "u");

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: ci,
  // the run's template database, pushed once and dropped as the run ends
  globalSetup: "./src/databases.ts",
  grepInvert: PENDING_TESTS.map(titled),
  reporter: ci ? "github" : "list",
  // a flaky flow is a bug to fix, not a run to repeat
  retries: 0,
  testDir: "src",
  testIgnore: PENDING_FILES,
  timeout: 120_000,
  // the full Chromium in its new headless mode, the one that loads an extension
  use: { channel: "chromium", trace: "retain-on-failure" },
  workers: ci ? 2 : undefined,
});
