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

import type { ChatMessage } from "@/renderer/stores/agent-store";

export function ChatMessageView({ message }: { message: ChatMessage }) {
  const first = message.parts[0];
  if (!first) return null;

  // Tool execution — encoded as an assistant message whose only part is a
  // dynamic-tool. Routed straight to the AI Elements Tool composition.
  if (first.type === "dynamic-tool") {
    return (
      <div className="mr-8">
        <Tool className="bg-foreground/5 backdrop-blur-sm">
          <ToolHeader
            type="dynamic-tool"
            toolName={first.toolName}
            state={first.state as ToolPart["state"]}
          />
          {first.state === "output-available" || first.state === "output-error" ? (
            <ToolContent>
              <ToolOutput
                output={first.state === "output-available" ? (first.output as unknown) : undefined}
                errorText={first.state === "output-error" ? first.errorText : undefined}
              />
            </ToolContent>
          ) : null}
        </Tool>
      </div>
    );
  }

  // Text part — user, assistant, or steer (steer is a user message marked
  // with metadata.steer = true).
  if (first.type !== "text") return null;
  const text = first.text;
  const imageCount = message.metadata?.imageCount ?? 0;

  if (message.metadata?.steer) {
    return (
      <div className="ml-8">
        <div className="rounded-md px-3 py-1.5 text-sm italic text-muted-foreground backdrop-blur-sm">
          {text && <span>{text}</span>}
          {imageCount > 0 ? (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <ImageIcon className="size-3" />
              {imageCount}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>
          {text && <span>{text}</span>}
          {imageCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <ImageIcon className="size-3" />
              {imageCount} image{imageCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      <MessageContent>
        {text ? (
          <Response shikiTheme={["github-dark-dimmed", "github-dark-dimmed"]}>{text}</Response>
        ) : (
          "..."
        )}
      </MessageContent>
    </Message>
  );
}
