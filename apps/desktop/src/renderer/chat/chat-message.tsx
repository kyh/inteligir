import { ImageIcon } from "lucide-react";
import { Message, MessageContent } from "@repo/ui/components/ai-elements/message";
import { Response } from "@repo/ui/components/ai-elements/response";

import { ToolExecutionView } from "@/renderer/components/tool-execution";
import type { ChatMessage } from "@/renderer/stores/agent-store";

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <Message from="user">
          <MessageContent>
            {message.text && <span>{message.text}</span>}
            {message.imageCount && message.imageCount > 0 ? (
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
            {message.imageCount && message.imageCount > 0 ? (
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
            {message.text ? <Response>{message.text}</Response> : "..."}
          </MessageContent>
        </Message>
      );

    case "tool":
      return (
        <div className="mr-8">
          <ToolExecutionView execution={message.execution} />
        </div>
      );
  }
}
