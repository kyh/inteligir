import { defineHook } from "eve/hooks";

// A thread's events, and its turns as they start and settle. A turn waits for its line's hooks, so
// a turn's row is written before its first model call.
export default defineHook({
  events: {
    "*": async (event, ctx) => {
      if (ctx.session.parent !== undefined) {
        return;
      }
      const { recordEveFact } = await import("@repo/service/agent/eve-agent");
      await recordEveFact({
        at: ctx.now.getTime(),
        auth: ctx.session.auth.current,
        event,
        position: ctx.position,
      });
    },
  },
});
