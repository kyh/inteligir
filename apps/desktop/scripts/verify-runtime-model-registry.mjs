// Verify that pi-ai's model registry resolves the model used by Inteligir.
// Catches "model id renamed/removed by pi-ai bump" before we ship a build that
// would crash at startup when it calls getModel(...).

import { getModel } from "@mariozechner/pi-ai";

const PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.5";

const model = getModel(PROVIDER, MODEL_ID);

if (!model) {
  console.error(`[verify] Model "${PROVIDER}/${MODEL_ID}" not found in pi-ai model registry.`);
  console.error(
    `[verify] Either bump pi-ai to a version that ships this model, or update packages/server/src/server/provider/provider-catalog.ts to a model that exists.`,
  );
  process.exit(1);
}

console.log(`[verify] OK: ${PROVIDER}/${MODEL_ID} -> ${model.name} (api=${model.api})`);
