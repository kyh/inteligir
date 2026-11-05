// the conditions a package's exports are resolved under for the service worker, which is a worker,
// with no DOM, and shares its chunks with the pages: a package's `worker` build is the one both can
// run, where its `browser` build may reach for `document` as it loads (the markdown codec's entity
// decoder does). The build resolves the bundle under them (wxt.config.ts) and the worker's suites
// their modules (vitest.config.ts). A file of its own, with no workspace import, since vitest's
// config loader leaves a linked package to node, which cannot load the contract's extensionless
// imports

import { defaultClientConditions } from "vite";

export const WORKER_CONDITIONS = ["worker", ...defaultClientConditions];
