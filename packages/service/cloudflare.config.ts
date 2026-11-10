import { bindings, defineConfig, defineWorker, exports } from "cf/config";
import { AGENT_ALLOWANCE, AGENT_PRICES } from "./agent-limits.ts";
import { compatibilityDate, compatibilityFlags } from "./compatibility.ts";
import { FILL_FAILED_QUEUE, FILL_QUEUE, FILL_RETRIES } from "./fill-queues.ts";
import { MESSAGES_FAKE_ORIGIN } from "./messages-service.ts";
import type { FillJob } from "./src/fill/fill-job.ts";
import { ORIGIN } from "./src/test-support/test-origin.ts";

import * as entrypoint from "./src/test-support/test-worker.ts" with { type: "cf-worker" };

// Never deployed: the suites' Worker, which the vitest plugin runs (vitest.config.ts) and
// `cf workers types` types this package's program from. The deployed Worker is apps/web's, whose
// program checks every module of this package its entry reaches against what it binds, so a binding
// named here and not there fails its build. Not the app's config: that one brings the fill queue's
// consumers, which would take a suite's messages behind its back, and the developer's .dev.vars.
const worker = defineWorker({
  name: "inteligir-service-test",
  entrypoint,
  compatibilityDate,
  compatibilityFlags,
  exports: {
    LibraryDO: exports.durableObject({ storage: "sqlite" }),
    AgentThreadDO: exports.durableObject({ storage: "sqlite" }),
    NoteDO: exports.durableObject({ storage: "sqlite" }),
  },
});

// the app's bindings, typed as it types them, each with the value every suite runs on; text rather
// than secret(), which would have the plugin read the shell's environment and .dev.vars
/** @public */
export default defineConfig(({ mode }) => ({
  worker: {
    ...worker,
    env: {
      ASSETS: bindings.assets(),
      BETTER_AUTH_SECRET: bindings.text<string>("test-better-auth-secret-000000000000"),
      // not the deployed floor, so a test that passes reads the binding: every test client sends
      // this version (buildHeaders in cloud-helpers.ts), and client-floor.test.ts goes under it
      MIN_CLIENT_BUILD: bindings.text("1.2.0"),
      LIBRARY_STORAGE_CAP_BYTES: bindings.text("1073741824"),
      // every test shares one ip; a suite that tests a window turns it on around those tests
      // (auth-rate-limit.test.ts and invite-signup.test.ts among them)
      RATE_LIMIT_DISABLED: bindings.text<"true" | "false">("true"),
      FILL_DELIVERY: bindings.json({ deadLetterQueue: FILL_FAILED_QUEUE, retries: FILL_RETRIES }),
      // no gateway: every suite's agent reaches the scripted Messages API, which the outbound
      // service answers at this address (messages-service.ts)
      AI_GATEWAY_TOKEN: bindings.text<string>(""),
      AGENT_GATEWAY_URL: bindings.text<string>(""),
      ANTHROPIC_FAKE_URL: mode === "test" ? bindings.text<string>(MESSAGES_FAKE_ORIGIN) : undefined,
      // the deployed allowance and prices; a suite that spends otherwise hands its cell its own
      AGENT_ALLOWANCE: bindings.json(AGENT_ALLOWANCE),
      AGENT_PRICES: bindings.json(AGENT_PRICES),
      DB: bindings.d1({ name: "test" }),
      BLOBS: bindings.r2({ name: "test" }),
      // the producer alone, as no trigger consumes it: a suite hands the consumer its batch itself
      // (createMessageBatch)
      FILLS: bindings.queue<FillJob>({ name: FILL_QUEUE }),
      // absent from the suites, where reset-email.ts logs, and optional, as the app types them
      EMAIL: mode === "test" ? undefined : bindings.sendEmail({}),
      RESET_FROM_ADDRESS: mode === "test" ? undefined : bindings.text("no-reply@inteligir.app"),
      OAUTH_KV: bindings.kv(),
      // the origin every suite addresses the Worker at, as the deployment's own
      SITE_ORIGIN: bindings.text<string>(ORIGIN),
    },
  },
}));
