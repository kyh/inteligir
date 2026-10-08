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
  // the log and the traces keep every request's URL for up to seven days (docs/privacy.md)
  observability: {
    enabled: true,
    traces: { enabled: true, headSamplingRate: 0.01 },
  },
  // cf sends no code_update_strategy, so the API would cut every open sync socket on deploy; this
  // is wrangler's default, which lets them finish on the old code for up to 5 minutes
  unsafe: { metadata: { code_update_strategy: { max_delay: 300, mode: "deferred" } } },
  // RepoCell and Registry held the retired hosted vault: declared deleted, the deploy removes their
  // namespaces and every object's storage with them. Drop the two rows once a deploy has run with
  // them, as the earlier tombstones were.
  exports: {
    ThreadSyncDO: exports.durableObject({ storage: "sqlite" }),
    RepoCell: exports.durableObject({ state: "deleted" }),
    Registry: exports.durableObject({ state: "deleted" }),
  },
});

const durableObjects = {
  THREAD_SYNC: bindings.durableObject({ worker, exportName: "ThreadSyncDO" }),
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
    // A Preview gets its own Durable Object namespaces for free, and a preview-only D1
    // (.github/workflows/preview.yml creates it): a PR never reaches the production accounts.
    // No EMAIL: a preview must not mail real inboxes from the
    // production domain, and src/worker/auth/reset-email.ts logs instead when it is absent.
    env: isPreview
      ? {
          ...durableObjects,
          DB: bindings.d1({ name: "inteligir-auth-preview" }),
        }
      : {
          ...durableObjects,
          // schema is src/worker/db/schema.ts, applied with drizzle-kit push (no migration files)
          DB: bindings.d1({ name: "inteligir-auth", id: "005d0e52-f102-4298-8da9-492b672ed00f" }),
          // password-reset transport; needs email sending enabled + DNS onboarding once
          EMAIL: bindings.sendEmail({}),
        },
  },
}));
