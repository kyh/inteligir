import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";
import { compatibilityDate, compatibilityFlags } from "./compatibility.ts";

// the file path, not `@tanstack/react-start/server-entry`: the package export builds Start's
// default entry and drops the API routes (cloudflare/workers-sdk#11100). Imported, not named by
// path, so the generated Env types each Durable Object binding with its class.
import * as entrypoint from "./src/worker/server.ts" with { type: "cf-worker" };

const worker = defineWorker({
  name: "inteligir-web",
  entrypoint,
  compatibilityDate,
  compatibilityFlags,
  workersDev: true,
  // the log and the traces keep every request's URL for up to seven days, so no route carries a
  // vault path in one: the vault reads post it (docs/privacy.md)
  observability: {
    enabled: true,
    traces: { enabled: true, headSamplingRate: 0.01 },
  },
  exports: {
    ThreadSyncDO: exports.durableObject({ storage: "sqlite" }),
    RepoCell: exports.durableObject({ storage: "sqlite" }),
    Registry: exports.durableObject({ storage: "sqlite" }),
  },
});

const durableObjects = {
  THREAD_SYNC: bindings.durableObject({ worker, exportName: "ThreadSyncDO" }),
  // REPO and REGISTRY are durable-git's own classes, re-exported through the entry
  REPO: bindings.durableObject({ worker, exportName: "RepoCell" }),
  REGISTRY: bindings.durableObject({ worker, exportName: "Registry" }),
};

// A Preview must not claim the production hostnames, and gets its own Durable Object namespaces
// for free, and a preview-only D1 and bucket (.github/workflows/preview.yml creates them): a PR
// never reaches the production accounts or vault packs. No EMAIL: a preview must not mail real
// inboxes from the production domain, and src/worker/auth/reset-email.ts logs instead when it is
// absent. No unsafe metadata: a Preview upload refuses it, and a preview has no sockets worth
// draining.
const previewWorker = {
  ...worker,
  triggers: [],
  env: {
    ...durableObjects,
    DB: bindings.d1({ name: "inteligir-auth-preview" }),
    PACK_CACHE: bindings.r2({ name: "inteligir-vault-preview" }),
    VAULT_STORAGE_CAP_BYTES: bindings.text("1073741824"),
  },
};

const productionWorker = {
  ...worker,
  triggers: [
    triggers.fetch({ pattern: "inteligir.com/*", zone: "inteligir.com" }),
    triggers.fetch({ pattern: "www.inteligir.com/*", zone: "inteligir.com" }),
  ],
  // cf sends no code_update_strategy, so the API would cut every open sync socket on deploy; this
  // is wrangler's default, which lets them finish on the old code for up to 5 minutes
  unsafe: { metadata: { code_update_strategy: { max_delay: 300, mode: "deferred" } } },
  env: {
    ...durableObjects,
    // schema is src/worker/db/schema.ts, applied with drizzle-kit push (no migration files)
    DB: bindings.d1({ name: "inteligir-auth", id: "005d0e52-f102-4298-8da9-492b672ed00f" }),
    // pack bytes only; without it durable-git stores packs in the cell's SQLite, which
    // caps vault size
    PACK_CACHE: bindings.r2({ name: "inteligir-vault" }),
    // what one account's hosted vault may store, history included: 1 GiB
    VAULT_STORAGE_CAP_BYTES: bindings.text("1073741824"),
    // password-reset transport; needs email sending enabled + DNS onboarding once
    EMAIL: bindings.sendEmail({}),
  },
};

export default defineConfig(({ isPreview }) => ({
  worker: isPreview ? previewWorker : productionWorker,
}));
