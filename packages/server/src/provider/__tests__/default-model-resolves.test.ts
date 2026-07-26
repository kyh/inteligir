// Every shipped provider's defaultModelId must exist in the registry that
// provider actually resolves against.
//
// Why this is its own file, and why it's DERIVED: normalizeSelection falls
// back to `catalogEntry(provider).defaultModelId` without checking the id
// exists, and resolveModelSelection (pi/model.ts) then throws — inside
// start(). So a pi-ai bump that renames or retires a model turns a fresh
// install of that provider into a boot failure, with nothing between the
// rename and the user. This is the AUTHORITATIVE guard because it runs on
// every `pnpm verify`; apps/desktop's verify-runtime-model-registry.mjs
// repeats the same check at release time, against the exact pi-ai the build
// will bundle.
//
// The loop is over listSupportedProviders() rather than a hand-written list
// so adding a provider is covered the moment its entry lands — the failure
// mode this protects against is precisely the one a maintained list has.
// faux is excluded because its models live on a live in-process registration,
// not pi-ai's static registry; listProviderModels already routes it there, so
// including it would assert nothing about the registry this test exists for.

import { describe, expect, it } from "vitest";

import { setDevFlagsAllowed } from "@repo/bridge/dev-flags";
import { FAUX_PROVIDER_ID } from "@repo/agent/provider/faux-provider";

import { listProviderModels, listSupportedProviders } from "../provider-catalog";

describe("shipped provider defaults resolve", () => {
  it("every catalog entry's defaultModelId is a model that provider can run", () => {
    // Dev flags stay OFF: this is about what SHIPS, and faux is dev-only.
    setDevFlagsAllowed(false);
    const entries = listSupportedProviders().filter((entry) => entry.id !== FAUX_PROVIDER_ID);
    // Guard the guard — an empty list would make every assertion below vacuous.
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const known = listProviderModels(entry.id).map((model) => model.id);
      expect(
        known,
        `${entry.id}: defaultModelId "${entry.defaultModelId}" is not in the registry. ` +
          `A new install picking ${entry.label} would throw inside start(). Point ` +
          `provider-catalog.ts at a model that exists (available: ${known.join(", ")}).`,
      ).toContain(entry.defaultModelId);
    }
  });
});
