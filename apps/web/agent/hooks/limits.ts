import type { Fact } from "eve/events";
import { defineHook } from "eve/hooks";
import type { HookContext } from "eve/hooks";

const limit = async (event: Fact, ctx: HookContext) => {
  const { limitEveFact } = await import("@repo/service/eve/eve-agent");

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
