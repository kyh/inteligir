// base.router is the completeness check: a handler drifting from its contract
// row, or a procedure nobody implemented, fails to compile here.

import { cloudRouter } from "./cloud/cloud-router";
import { base } from "./orpc";
import { systemRouter } from "./system/system-router";
import { threadsRouter } from "./threads/threads-router";

export const localRouter = base.router({
  cloud: cloudRouter,
  system: systemRouter,
  threads: threadsRouter,
});
