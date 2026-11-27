import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { cloudOrigin } from "./connection";

const NAMED = "cloud-origin";

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the cloud a build saves to", () => {
  it("is the production site in a store build, whatever its storage names", async () => {
    vi.stubEnv("MODE", "store");
    await browser.storage.local.set({ [NAMED]: "http://localhost:51234" });
    await expect(cloudOrigin()).resolves.toBe("https://www.inteligir.com");
  });

  it("is `pnpm dev:web`'s app in the dev build, or the local app its storage names", async () => {
    await expect(cloudOrigin()).resolves.toBe("http://localhost:5174");
    await browser.storage.local.set({ [NAMED]: "http://localhost:51234" });
    await expect(cloudOrigin()).resolves.toBe("http://localhost:51234");
  });

  it("is never a site the dev build's one host does not reach", async () => {
    for (const named of [
      "https://www.inteligir.com",
      "https://localhost:5174",
      "http://127.0.0.1:5174",
      "http://localhost.evil.example:5174",
      "http://localhost:5174/library",
      5174,
    ]) {
      await browser.storage.local.set({ [NAMED]: named });
      await expect(cloudOrigin(), String(named)).resolves.toBe("http://localhost:5174");
    }
  });
});
