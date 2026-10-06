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

export default defineConfig(({ isPreview }) => ({
  worker: {
    ...worker,
    // a Preview must not claim the production hostnames
    triggers: isPreview
      ? []
      : [
          triggers.fetch({ pattern: "inteligir.com/*", zone: "inteligir.com" }),
          triggers.fetch({ pattern: "www.inteligir.com/*", zone: "inteligir.com" }),
        ],
    // A Preview gets its own Durable Object namespaces for free, and a preview-only D1 and
    // bucket (.github/workflows/preview.yml creates them): a PR never reaches the production
    // accounts or vault packs. No EMAIL: a preview must not mail real inboxes from the
    // production domain, and src/worker/auth/reset-email.ts logs instead when it is absent.
    env: isPreview
      ? {
          ...durableObjects,
          DB: bindings.d1({ name: "inteligir-auth-preview" }),
          PACK_CACHE: bindings.r2({ name: "inteligir-vault-preview" }),
          VAULT_STORAGE_CAP_BYTES: bindings.text("1073741824"),
        }
      : {
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
  },
}));
