import { defineDynamic, defineInstructions } from "eve/instructions";

export default defineDynamic(async (ctx) => {
  const { callerFilingRules } = await import("@repo/service/eve/eve-agent");

  const rules = await ctx.memo(
    ["filing-rules", ctx.turn?.id ?? null],
    async () => await callerFilingRules(ctx.session.auth.current),
  );

  return rules === null ? null : defineInstructions({ content: rules });
});
