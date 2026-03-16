import { Markdown } from "@/renderer/components/markdown";
import { ToolExecutionView } from "@/renderer/components/tool-execution";
import type { ChatMessage } from "@/renderer/stores/agent-store";

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="bg-secondary/80 w-fit rounded-md px-3 py-1.5 text-sm backdrop-blur-sm">
          {message.text}
        </div>
      );

    case "steer":
      return (
        <div className="text-muted-foreground w-fit rounded-md px-3 py-1.5 text-sm italic backdrop-blur-sm">
          {message.text}
        </div>
      );

    case "assistant":
      return (
        <div className="bg-background/60 w-fit max-w-full rounded-md px-3 py-1.5 text-sm backdrop-blur-sm">
          {message.text ? <Markdown content={message.text} /> : "..."}
        </div>
      );

    case "tool":
      return (
        <div className="w-fit backdrop-blur-sm">
          <ToolExecutionView execution={message.execution} />
        </div>
      );
  }
}
