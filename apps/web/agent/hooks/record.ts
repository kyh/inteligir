import { defineHook } from "eve/hooks";

export default defineHook({
  events: {
    "*": async (event, ctx) => {
      if (ctx.session.parent !== undefined) {
        return;
      }

      const { recordEveFact } = await import("@repo/service/eve/eve-agent");
      await recordEveFact({
        at: ctx.now.getTime(),
        auth: ctx.session.auth.current,
        event,
        position: ctx.position,
      });
    },
  },
});
