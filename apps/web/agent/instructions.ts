import { AGENT_SYSTEM_PROMPT } from "@repo/service/agent/agent-prompt";
import { defineInstructions } from "eve/instructions";

export default defineInstructions({ content: AGENT_SYSTEM_PROMPT });
