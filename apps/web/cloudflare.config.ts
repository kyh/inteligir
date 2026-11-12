import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";
import { z } from "zod";
import { AGENT_ALLOWANCE } from "@repo/service/agent-limits";
import { compatibilityDate, compatibilityFlags } from "@repo/service/compatibility";
import type { FillJob } from "@repo/service/fill/fill-job";
import {
  FILL_BATCH_SIZE,
  FILL_FAILED_QUEUE,
  FILL_QUEUE,
  FILL_RETRIES,
} from "@repo/service/fill-queues";

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
  // the log and the traces keep every request's path for up to seven days, so no route carries a
  // library's name for anything in one, and drop the query string, which carries sign-in codes and
  // tickets (docs/privacy.md)
  observability: {
    enabled: true,
    redactQueryString: true,
    traces: { enabled: true, headSamplingRate: 0.01 },
  },
  // a live class is reached through `ctx.exports`, with no env binding
  // (developers.cloudflare.com/cf/projects/cloudflare-config/)
  exports: {
    // each account's library cell (packages/service/src/library/library-do.ts)
    LibraryDO: exports.durableObject({ storage: "sqlite" }),
    // each conversation with the built-in agent, which only its account's cell names
    // (packages/service/src/agent/agent-thread.ts)
    AgentThreadDO: exports.durableObject({ storage: "sqlite" }),
    // each note's live body, which only its account's cell and the note's door name
    // (packages/service/src/note/note-do.ts)
    NoteDO: exports.durableObject({ storage: "sqlite" }),
    // deleted classes: each namespace is a tombstone, its class in no entry, until a deploy's
    // response names it safe to drop from this map (docs/releasing.md § 5)
    ThreadSyncDO: exports.durableObject({ state: "deleted" }),
    RepoCell: exports.durableObject({ state: "deleted" }),
    Registry: exports.durableObject({ state: "deleted" }),
  },
});

// the oldest build /v1 answers (packages/service/src/client-floor.ts): a request naming no build,
// or one below this, is refused as outdated, so the build is told to update rather than meeting a
// wire it does not speak. A change that drops a /v1 shape an older build reads owes the floor, and
// the release after it raises this to its own version (docs/releasing.md § 1, step 3); every
// checkout reports the last release's version, so the floor never passes one before then.
const MIN_CLIENT_BUILD = "0.7.0";

// the production AI Gateway, `inteligir`, on its provider-native Anthropic route
// (developers.cloudflare.com/ai-gateway/usage/providers/anthropic/). The account comes from the
// deploy job's CLOUDFLARE_ACCOUNT_ID (apps/web/turbo.json hands it to the build task). Node
// evaluates this file, but the Worker's own program types it too and declares no `process`, so it
// is parsed off `globalThis`; a build without it, CI's, names no gateway, and its Worker refuses
// every agent send
const gatewayUrl = (): string => {
  const account = z
    .object({
      process: z.object({
        env: z.object({
          CLOUDFLARE_ACCOUNT_ID: z
            .string()
            .regex(/^[0-9a-f]{32}$/u)
            .optional(),
        }),
      }),
    })
    .parse(globalThis).process.env.CLOUDFLARE_ACCOUNT_ID;
  return account === undefined
    ? ""
    : `https://gateway.ai.cloudflare.com/v1/${account}/inteligir/anthropic`;
};

// cf reads the default export of the file it is pointed at
/** @public */
export default defineConfig(({ isPreview, mode }) => {
  // a Preview would bind production's accounts, files, fills and connected assistants
  if (isPreview) {
    throw new Error("inteligir-web has no Preview: every binding here is production's");
  }
  return {
    worker: {
      ...worker,
      triggers: [
        triggers.fetch({ pattern: "inteligir.com/*", zone: "inteligir.com" }),
        triggers.fetch({ pattern: "www.inteligir.com/*", zone: "inteligir.com" }),
        // the pages the cloud reads, consumed by this Worker (@repo/service/fill-queues)
        triggers.queue({
          deadLetterQueue: FILL_FAILED_QUEUE,
          maxBatchSize: FILL_BATCH_SIZE,
          maxRetries: FILL_RETRIES,
          name: FILL_QUEUE,
        }),
        triggers.queue({ maxRetries: FILL_RETRIES, name: FILL_FAILED_QUEUE }),
      ],
      // no code_update_strategy: a deploy restarts every Durable Object and drops its sockets, and
      // each client reconnects and catches up by itself, so none waits on the old code to drain
      env: {
        // the site's built files, the library's among them
        ASSETS: bindings.assets(),
        // Better Auth's signing key: `cf workers secrets update` in production, and locally the root
        // .env, which the dev server folds into the names this file declares only because a secret
        // is declared
        BETTER_AUTH_SECRET: bindings.secret(),
        MIN_CLIENT_BUILD: bindings.text(MIN_CLIENT_BUILD),
        // what one account's library may hold, its files and its change sets included: 1 GiB
        LIBRARY_STORAGE_CAP_BYTES: bindings.text("1073741824"),
        // the auth limiter's off switch, "true" only where one caller signs up many accounts: the
        // suites, the e2e fixture, a local script's root .env
        RATE_LIMIT_DISABLED: bindings.text<"true" | "false">("false"),
        // every signed call's minute, a ceiling past what a person makes, so a loop meets it
        // (packages/service/src/rate-limit.ts): each signed call on /v1/rpc, keyed on the session,
        // where a screen reads its pages again on each socket frame and a phone back online lands
        // its saves a call each; a library's files, where a grid of covers and a video read range
        // by range burst; and each call a connected assistant makes, keyed on its grant, a turn's
        // few dozen
        RPC_LIMIT: bindings.rateLimit({ namespace: "1001", simple: { limit: 1200, period: 60 } }),
        BLOBS_LIMIT: bindings.rateLimit({ namespace: "1002", simple: { limit: 3000, period: 60 } }),
        CONNECTOR_LIMIT: bindings.rateLimit({
          namespace: "1003",
          simple: { limit: 300, period: 60 },
        }),
        // what the fill consumer needs of its queues' config, handed over rather than imported,
        // since the dev server cannot load a module this file also loads (@repo/service/fill-queues)
        FILL_DELIVERY: bindings.json({ deadLetterQueue: FILL_FAILED_QUEUE, retries: FILL_RETRIES }),
        // the token of the AI Gateway, whose Authenticated Gateway admits only requests that carry
        // it (packages/service/src/agent/anthropic-client.ts): `cf workers secrets update` in
        // production, the root .env for a gateway of a developer's own. The Worker holds no
        // Anthropic key: the gateway stores it
        AI_GATEWAY_TOKEN: bindings.secret(),
        // the turns the built-in agent may run for one account; its dollars are the gateway's spend
        // limit, split by the `account` the client names (@repo/service/agent-limits, read by
        // packages/service/src/agent/agent-allowance.ts)
        AGENT_ALLOWANCE: bindings.json(AGENT_ALLOWANCE),
        // none for the local Worker: the root .env names the scripted Messages API, or a gateway of
        // the developer's own (.env.example), never production's
        AGENT_GATEWAY_URL: bindings.text<string>(mode === "development" ? "" : gatewayUrl()),
        // the scripted Messages API the root .env names (tools/messages-fake), declared
        // by `vite dev` alone, so no deployed Worker can be pointed at one
        ANTHROPIC_FAKE_URL: mode === "development" ? bindings.text<string>("") : undefined,
        // schema is packages/db/src/d1/schema.ts, applied with drizzle-kit push (no migration files)
        DB: bindings.d1({ name: "inteligir-auth", id: "005d0e52-f102-4298-8da9-492b672ed00f" }),
        // the library's files, under acct/<userId>/
        BLOBS: bindings.r2({ name: "inteligir-vault" }),
        FILLS: bindings.queue<FillJob>({ name: FILL_QUEUE }),
        // password-reset transport; needs email sending enabled + DNS onboarding once
        EMAIL: bindings.sendEmail({}),
        // the reset email's sender, on the domain onboarded for Email Sending
        RESET_FROM_ADDRESS: bindings.text("no-reply@inteligir.app"),
        // the connector's OAuth clients, grants and tokens, and nothing else
        // (packages/service/src/connector): no id, so the first deploy provisions the namespace and
        // every later one keeps it linked
        // (developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
        OAUTH_KV: bindings.kv(),
        // this deployment's own origin, the connector's OAuth issuer and the root of its resource,
        // never the request's Host; `vite dev` serves the Worker on its pinned port (vite.config.ts)
        SITE_ORIGIN: bindings.text<string>(
          mode === "development" ? "http://localhost:5174" : "https://inteligir.com",
        ),
      },
    },
  };
});
