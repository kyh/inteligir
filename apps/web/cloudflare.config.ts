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
    // the account's live sockets (AccountSocketDO), deployed under the class name the retired
    // thread log had: a Preview is a version of this script, and a version can neither add a class
    // nor delete one, so a new name would leave every PR's preview unable to bind it until a
    // deploy migrated it. An object that still holds the thread log's tables drops them on waking
    ThreadSyncDO: exports.durableObject({ storage: "sqlite" }),
    RepoCell: exports.durableObject({ storage: "sqlite" }),
    Registry: exports.durableObject({ storage: "sqlite" }),
  },
});

// the oldest build /v1 answers (src/worker/client-floor.ts). 0.6.0 sends no build header, which the
// floor refuses on its own, so this admits exactly the builds that send one, a checkout's included
// until its release raises the version; raise it to retire a wire shape every older build reads.
// OWED BY THE NEXT RELEASE, which sets it to its own version (docs/releasing.md § 1): the thread
// log, the dispatch inbox and their socket frames are retired, so a build that reports 0.6.0
// pushes, pulls and claims against routes this Worker no longer answers, reads each as not-found
// rather than as outdated, and keeps retrying them; and the vault's media table gains PDF, video
// and audio rows, whose commits an older build cannot serve
const MIN_CLIENT_BUILD = "0.6.0";

const durableObjects = {
  ACCOUNT_SOCKET: bindings.durableObject({ worker, exportName: "ThreadSyncDO" }),
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
    MIN_CLIENT_BUILD: bindings.text(MIN_CLIENT_BUILD),
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
    MIN_CLIENT_BUILD: bindings.text(MIN_CLIENT_BUILD),
    // password-reset transport; needs email sending enabled + DNS onboarding once
    EMAIL: bindings.sendEmail({}),
  },
};

export default defineConfig(({ isPreview }) => ({
  worker: isPreview ? previewWorker : productionWorker,
}));
