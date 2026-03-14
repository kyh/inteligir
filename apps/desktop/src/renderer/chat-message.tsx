import { cn } from "@repo/ui/utils";

import { Markdown } from "./markdown";
import type { ChatMessage } from "./stores/agent-store";
import { ToolExecutionView } from "./tool-execution";

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="max-w-[80%] self-end rounded-md bg-secondary px-3 py-1.5 text-sm">
          {message.text}
        </div>
      );

    case "steer":
      return (
        <div className="max-w-[80%] self-end rounded-md px-3 py-1.5 text-sm italic text-muted-foreground">
          {message.text}
        </div>
      );

    case "assistant":
      return (
        <div className={cn("max-w-[90%] self-start text-sm")}>
          {message.text ? <Markdown content={message.text} /> : "..."}
        </div>
      );

    case "tool":
      return (
        <div className="self-start">
          <ToolExecutionView execution={message.execution} />
        </div>
      );
  }
}
