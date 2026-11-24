import { defineDynamic, defineTool } from "eve/tools";

export default defineDynamic(async () => {
  const { agentCallModelOutput, agentTools, runAgentTool } =
    await import("@repo/service/eve/eve-agent");

  return Object.fromEntries(
    agentTools().map((tool) => [
      tool.name,
      defineTool({
        description: tool.description,
        execute: async (input, call) =>
          await runAgentTool(
            {
              auth: call.session.auth.current,
              callId: call.callId,
              eveSessionId: call.session.id,
              input,
              turnId: call.session.turn.id,
            },
            tool,
          ),
        inputSchema: tool.input,
        toModelOutput: agentCallModelOutput,
      }),
    ]),
  );
});
