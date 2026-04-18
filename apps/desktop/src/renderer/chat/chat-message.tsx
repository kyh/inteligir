import { cn } from "@repo/ui/lib/utils";

import { Markdown } from "@/renderer/components/markdown";
import { ToolExecutionView } from "@/renderer/components/tool-execution";
import type { ChatMessage } from "@/renderer/stores/agent-store";

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="ml-8">
          <div className="bg-foreground/20 rounded-md px-3 py-1.5 text-sm">
            {message.text}
          </div>
        </div>
      );

    case "steer":
      return (
        <div className="ml-8">
          <div className="rounded-md px-3 py-1.5 text-sm italic text-muted-foreground">
            {message.text}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className={cn("mr-8")}>
          <div className="bg-foreground/10 text-foreground/80 rounded-md px-3 py-1.5 text-sm">
            {message.text ? <Markdown content={message.text} /> : "..."}
          </div>
        </div>
      );

    case "tool":
      return (
        <div className="mr-8">
          <ToolExecutionView execution={message.execution} />
        </div>
      );
  }
}
