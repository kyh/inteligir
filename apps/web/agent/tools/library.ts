import { defineDynamic, defineTool } from "eve/tools";

// One tool per library row tagged a tool, run as the session's account in the turn that called
// it; a call answers its outcome as data, which the thread keeps, and the model reads its text.
export default defineDynamic(async () => {
  const { agentCallModelOutput, agentTools, runAgentTool } =
    await import("@repo/service/agent/eve-agent");
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
