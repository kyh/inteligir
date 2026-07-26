// Verify that pi-ai's model registry resolves EVERY shipped provider default.
// Catches "model id renamed/removed by pi-ai bump" before we ship a build that
// would crash at startup when it calls getModel(...): normalizeSelection falls
// back to a provider's defaultModelId WITHOUT checking the id exists, and
// resolveModelSelection then throws inside start().
//
// The authoritative check is the derived unit test
// (packages/server/src/provider/__tests__/default-model-resolves.test.ts),
// which runs on every `pnpm verify`. This script is the release-time repeat of
// it against the same pi-ai the build will bundle.
//
// The pairs are READ OUT of provider-catalog.ts rather than hardcoded: a
// hand-maintained list in a release script is exactly the thing that falls
// behind the catalog, and a provider it never learned about ships unchecked.
// We parse instead of import because @repo/server's exports map is narrow
// (only the entrypoints desktop main composes) and the catalog is not on it;
// widening a package boundary for a build script is the wrong trade.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getModel } from "@earendil-works/pi-ai/compat";

const CATALOG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/server/src/provider/provider-catalog.ts",
);

// faux is a dev-flag provider whose models live on a live in-process
// registration, not pi-ai's static registry — getModel would never find them.
// Its catalog entry writes `id: FAUX_PROVIDER_ID`, so the constant NAME is
// listed alongside the value it holds; anything else that arrives as an
// identifier we can't resolve falls through to getModel and fails loudly.
const SKIP_PROVIDERS = new Set(["faux", "FAUX_PROVIDER_ID"]);

// Matches a CatalogEntry object literal: `id:` (a string literal, or a bare
// identifier as the faux entry uses) followed by `defaultModelId: "…"`,
// tolerating the label/comment lines between them but never crossing the `}`
// that closes an entry.
const ENTRY = /id:\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))[^}]*?defaultModelId:\s*"([^"]+)"/g;

// How many entries there SHOULD be, counted independently of the regex above.
// Without this, a reordered field (defaultModelId before id) or a renamed key
// makes ENTRY quietly match fewer entries and the script still exits 0 —
// re-creating exactly the blind spot a hardcoded pair list would have.
const DECLARATION = /:\s*CatalogEntry\s*=\s*\{/g;

const source = readFileSync(CATALOG, "utf8");
const declared = [...source.matchAll(DECLARATION)].length;
const parsed = [...source.matchAll(ENTRY)].map(([, literalId, identifierId, modelId]) => ({
  provider: literalId ?? identifierId,
  modelId,
}));

if (declared === 0 || parsed.length !== declared) {
  console.error(
    `[verify] Parsed ${parsed.length} provider default(s) out of ${declared} CatalogEntry ` +
      `declaration(s) in ${CATALOG}.`,
  );
  console.error(
    `[verify] The catalog's shape changed — fix the ENTRY regex in this script. ` +
      `Failing loudly beats silently verifying nothing.`,
  );
  process.exit(1);
}

const pairs = parsed.filter(({ provider }) => !SKIP_PROVIDERS.has(provider));

let failed = false;
for (const { provider, modelId } of pairs) {
  const model = getModel(provider, modelId);
  if (!model) {
    failed = true;
    console.error(`[verify] Model "${provider}/${modelId}" not found in pi-ai model registry.`);
    continue;
  }
  // pi-ai types `Api` as `KnownApi | (string & {})`; the type-aware pass does
  // not read that intersection as string-like, so the interpolation is fine.
  // oxlint-disable-next-line typescript/restrict-template-expressions
  console.log(`[verify] OK: ${provider}/${modelId} -> ${model.name} (api=${model.api})`);
}

if (failed) {
  console.error(
    `[verify] Either bump pi-ai to a version that ships the missing model(s), or update ` +
      `packages/server/src/provider/provider-catalog.ts to models that exist.`,
  );
  process.exit(1);
}
