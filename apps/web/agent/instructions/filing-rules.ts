import { defineDynamic, defineInstructions } from "eve/instructions";

// The person's filing rules, the prompt's last part as its own words expect them: after the static
// prompt, so every account's calls share its cached prefix, and read once a turn, so a save holds
// from the next one.
export default defineDynamic(async (ctx) => {
  const { callerFilingRules } = await import("@repo/service/agent/eve-agent");
  const rules = await ctx.memo(
    ["filing-rules", ctx.turn?.id ?? null],
    async () => await callerFilingRules(ctx.session.auth.current),
  );
  return rules === null ? null : defineInstructions({ content: rules });
});
