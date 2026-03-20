// ---------------------------------------------------------------------------
// Custom LLM adapter — bridges pi-coding-agent into LiveKit's voice pipeline
//
// The voice pipeline calls llm.chat() with the transcribed user text.
// This adapter extracts that text, calls pi-coding-agent.sendMessage(),
// subscribes to streaming events, and yields ChatChunks back to TTS.
// ---------------------------------------------------------------------------

import { llm, type APIConnectOptions } from "@livekit/agents";

import { Agent } from "@/agent/setup";
import { isRecord } from "@/shared/ipc";

export class PiLLMAdapter extends llm.LLM {
  private agent: Agent;

  constructor(agent: Agent) {
    super();
    this.agent = agent;
  }

  label(): string {
    return "pi-coding-agent";
  }

  override get model(): string {
    return "pi-coding-agent";
  }

  override get provider(): string {
    return "inteligir";
  }

  chat(options: {
    chatCtx: llm.ChatContext;
    toolCtx?: llm.ToolContext;
    connOptions?: APIConnectOptions;
    parallelToolCalls?: boolean;
    toolChoice?: llm.ToolChoice;
    extraKwargs?: Record<string, unknown>;
  }): PiLLMStream {
    return new PiLLMStream(this, this.agent, {
      chatCtx: options.chatCtx,
      toolCtx: options.toolCtx,
      connOptions: options.connOptions ?? { maxRetry: 1, retryIntervalMs: 0, timeoutMs: 30_000 },
    });
  }
}

class PiLLMStream extends llm.LLMStream {
  private agent: Agent;

  constructor(
    adapter: PiLLMAdapter,
    agent: Agent,
    options: {
      chatCtx: llm.ChatContext;
      toolCtx?: llm.ToolContext;
      connOptions: APIConnectOptions;
    },
  ) {
    super(adapter, options);
    this.agent = agent;
  }

  protected async run(): Promise<void> {
    // Extract the latest user message from chat context
    const items = this.chatCtx.items;
    let userText = "";
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item && item instanceof llm.ChatMessage && item.role === "user") {
        userText = item.textContent ?? "";
        break;
      }
    }

    if (!userText) {
      this.output.close();
      return;
    }

    let chunkIndex = 0;
    let done = false;

    const cleanup = (unsub: () => void): void => {
      if (done) return;
      done = true;
      unsub();
      this.output.close();
    };

    // Subscribe to agent events before sending the message
    const unsub = this.agent.subscribe((event) => {
      if (!isRecord(event)) return;

      if (event.type === "message_update") {
        const ame = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : null;
        if (ame && ame.type === "text_delta" && typeof ame.delta === "string" && ame.delta) {
          this.output.put({
            id: `pi-${chunkIndex++}`,
            delta: {
              role: "assistant",
              content: ame.delta,
            },
          });
        }
      }

      if (event.type === "agent_end") {
        cleanup(unsub);
      }
    });

    try {
      await this.agent.sendMessage(userText);
      // Wait for agent to finish (agent_end event will close the output)
      await this.agent.waitForIdle(120_000);
    } finally {
      cleanup(unsub);
    }
  }
}
