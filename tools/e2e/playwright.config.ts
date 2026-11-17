import { defineConfig } from "@playwright/test";

const ci = process.env.CI !== undefined;

// the flows the app on Next does not run yet, by file; each leaves as its area lands
const PENDING = [
  "account.spec.ts",
  "agent-context.spec.ts",
  "agent-panel.spec.ts",
  "connector.spec.ts",
  "editor.spec.ts",
  "extension.spec.ts",
  "import.spec.ts",
  "library.spec.ts",
  "live-note.spec.ts",
  "note-links.spec.ts",
  "saving.spec.ts",
  "search.spec.ts",
  "site-faults.spec.ts",
  "site.spec.ts",
];

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: ci,
  reporter: ci ? "github" : "list",
  // a flaky flow is a bug to fix, not a run to repeat
  retries: 0,
  testDir: "src",
  testIgnore: PENDING,
  timeout: 120_000,
  // the full Chromium in its new headless mode, the one that loads an extension
  use: { channel: "chromium", trace: "retain-on-failure" },
  workers: ci ? 2 : undefined,
});
