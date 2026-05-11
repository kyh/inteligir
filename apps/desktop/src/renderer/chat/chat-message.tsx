import { ImageIcon } from "lucide-react";
import { Message, MessageContent } from "@repo/ui/components/ai-elements/message";
import { Response } from "@repo/ui/components/ai-elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
  type ToolPart,
} from "@repo/ui/components/ai-elements/tool";

import type { ChatMessage, ToolExecution } from "@/renderer/stores/agent-store";

const executionStateMap: Record<ToolExecution["status"], ToolPart["state"]> = {
  running: "input-available",
  done: "output-available",
  error: "output-error",
};

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <Message from="user">
          <MessageContent>
            {message.text && <span>{message.text}</span>}
            {(message.imageCount ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <ImageIcon className="size-3" />
                {message.imageCount} image{message.imageCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </MessageContent>
        </Message>
      );

    case "steer":
      return (
        <div className="ml-8">
          <div className="rounded-md px-3 py-1.5 text-sm italic text-muted-foreground backdrop-blur-sm">
            {message.text && <span>{message.text}</span>}
            {(message.imageCount ?? 0) > 0 ? (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <ImageIcon className="size-3" />
                {message.imageCount}
              </span>
            ) : null}
          </div>
        </div>
      );

    case "assistant":
      return (
        <Message from="assistant">
          <MessageContent>
            {message.text ? (
              <Response shikiTheme={["github-dark-dimmed", "github-dark-dimmed"]}>
                {message.text}
              </Response>
            ) : (
              "..."
            )}
          </MessageContent>
        </Message>
      );

    case "tool": {
      const { execution } = message;
      const hasResult = execution.resultText.length > 0;
      return (
        <div className="mr-8">
          <Tool className="bg-foreground/5 backdrop-blur-sm">
            <ToolHeader
              type="dynamic-tool"
              toolName={execution.toolName}
              state={executionStateMap[execution.status]}
            />
            {hasResult && (
              <ToolContent>
                <ToolOutput
                  output={execution.isError ? null : execution.resultText}
                  errorText={execution.isError ? execution.resultText : undefined}
                />
              </ToolContent>
            )}
          </Tool>
        </div>
      );
    }
  }
}
