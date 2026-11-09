// The fills' queues, spelled once for the configs that declare them (`cloudflare.config.ts`,
// `vitest.config.ts`) and the suites that deliver to them. The Worker's own code never imports it:
// the dev server cannot load a module the config also loads, so the consumer reads its dead-letter
// queue and retries from the `FILL_DELIVERY` binding the config derives from these.

// the pages the cloud reads wait here for the consumer the Worker exports (`src/worker/fill/fill-consumer.ts`)
export const FILL_QUEUE = "inteligir-fill";
// what the first queue's retries could not read lands here, and its consumer says the failure in
// the item, so no link waits unread for good
export const FILL_FAILED_QUEUE = "inteligir-fill-failed";
// a preview's, which nothing consumes (developers.cloudflare.com/workers/previews/resources/)
export const FILL_PREVIEW_QUEUE = "inteligir-fill-preview";

// the queue's own retries of a message; the consumer's last delivery says the failure in the item
// rather than asking for another
export const FILL_RETRIES = 3;

// two pages a batch: a reading at the article's budget is seconds of CPU, and a consumer's
// invocation has 30 s of it (developers.cloudflare.com/workers/platform/limits/)
export const FILL_BATCH_SIZE = 2;
