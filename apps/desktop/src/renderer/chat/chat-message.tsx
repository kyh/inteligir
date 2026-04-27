import { ImageIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";

import { Markdown } from "@/renderer/components/markdown";
import { ToolExecutionView } from "@/renderer/components/tool-execution";
import type { ChatMessage } from "@/renderer/stores/agent-store";

function ImageAttachmentBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <ImageIcon className="size-3" />
      {count} image{count === 1 ? "" : "s"}
    </span>
  );
}

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="ml-8">
          <div className="bg-foreground/20 flex flex-col gap-1 rounded-md px-3 py-1.5 text-sm">
            {message.text && <span>{message.text}</span>}
            {message.imageCount && message.imageCount > 0 ? (
              <ImageAttachmentBadge count={message.imageCount} />
            ) : null}
          </div>
        </div>
      );

    case "steer":
      return (
        <div className="ml-8">
          <div className="flex flex-col gap-1 rounded-md px-3 py-1.5 text-sm italic text-muted-foreground">
            {message.text && <span>{message.text}</span>}
            {message.imageCount && message.imageCount > 0 ? (
              <ImageAttachmentBadge count={message.imageCount} />
            ) : null}
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
