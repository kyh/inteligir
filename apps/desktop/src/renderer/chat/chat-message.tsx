import { ImageIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";

import { Markdown } from "@/renderer/components/markdown";
import { ToolExecutionView } from "@/renderer/components/tool-execution";
import type { ChatMessage } from "@/renderer/stores/agent-store";

const BUBBLE_VARIANTS = {
  user: "bg-foreground/20",
  steer: "italic text-muted-foreground",
} as const;

function BubbleMessage({
  variant,
  text,
  imageCount = 0,
}: {
  variant: keyof typeof BUBBLE_VARIANTS;
  text: string;
  imageCount?: number;
}) {
  return (
    <div className="ml-8">
      <div
        className={cn(
          "flex flex-col gap-1 rounded-md px-3 py-1.5 text-sm",
          BUBBLE_VARIANTS[variant],
        )}
      >
        {text && <span>{text}</span>}
        {imageCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <ImageIcon className="size-3" />
            {imageCount} image{imageCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "user":
    case "steer":
      return (
        <BubbleMessage
          variant={message.kind}
          text={message.text}
          imageCount={message.imageCount}
        />
      );

    case "assistant":
      return (
        <div className="mr-8">
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
