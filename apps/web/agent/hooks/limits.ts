import type { Fact } from "eve/events";
import { defineHook } from "eve/hooks";
import type { HookContext } from "eve/hooks";

// The day's turns and dollars, and a turn's steps: a fact that spends past one stops the turn
// before its next model call. Typed handlers run before `record.ts`'s `*`, so a turn's row may be
// written here first.
const limit = async (event: Fact, ctx: HookContext): Promise<void> => {
  const { limitEveFact } = await import("@repo/service/agent/eve-agent");
  const stopped = await limitEveFact({
    at: ctx.now.getTime(),
    auth: ctx.session.auth.current,
    event,
    position: ctx.position,
    view: ctx.view,
  });
  if (stopped) {
    ctx.cancel();
  }
};

export default defineHook({
  events: {
    "call.settled": limit,
    "model.requested": limit,
    "turn.started": limit,
    "usage.recorded": limit,
  },
});
