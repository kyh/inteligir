// The service types its own program from its suites' Worker (packages/service/cloudflare.config.ts),
// so this program, typed from what deploys, is what holds the service to the deployed Worker: every
// service module server.ts reaches is checked here against the generated Env, and these claims hold
// the entry's exports to the objects the service reaches through ctx.exports.
import type { AgentThreadDO } from "@repo/service/agent/agent-thread";
import type { LibraryDO } from "@repo/service/library/library-do";
import { expectTypeOf, test } from "vitest";

test("the deployed entry exports each of the service's objects as a SQLite namespace", () => {
  expectTypeOf<Cloudflare.Exports["LibraryDO"]>().toExtend<DurableObjectNamespace<LibraryDO>>();
  expectTypeOf<Cloudflare.Exports["AgentThreadDO"]>().toExtend<
    DurableObjectNamespace<AgentThreadDO>
  >();
});
