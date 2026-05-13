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

function ImageCount({ count, withLabel }: { count: number; withLabel?: boolean }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <ImageIcon className="size-3" />
      {withLabel ? `${count} image${count === 1 ? "" : "s"}` : count}
    </span>
  );
}

export function ChatMessageView({ message }: { message: ChatMessage }) {
  const first = message.parts[0];
  if (!first) return null;

  if (first.type === "dynamic-tool") {
    const { state } = first;
    const hasOutput = state === "output-available" || state === "output-error";
    return (
      <div className="mr-8">
        <Tool className="bg-foreground/5 backdrop-blur-sm">
          <ToolHeader
            type="dynamic-tool"
            toolName={first.toolName}
            state={state as ToolPart["state"]}
          />
          {hasOutput && (
            <ToolContent>
              <ToolOutput
                output={state === "output-available" ? (first.output as unknown) : undefined}
                errorText={state === "output-error" ? first.errorText : undefined}
              />
            </ToolContent>
          )}
        </Tool>
      </div>
    );
  }

  if (first.type !== "text") return null;
  const text = first.text;
  const imageCount = message.metadata?.imageCount ?? 0;

  if (message.metadata?.steer) {
    return (
      <div className="ml-8">
        <div className="rounded-md px-3 py-1.5 text-sm italic text-muted-foreground backdrop-blur-sm">
          {text && <span>{text}</span>}
          {imageCount > 0 && (
            <span className="ml-2">
              <ImageCount count={imageCount} />
            </span>
          )}
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>
          {text && <span>{text}</span>}
          <ImageCount count={imageCount} withLabel />
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      <MessageContent>
        {text ? (
          <Response
            className="prose prose-sm prose-invert max-w-none break-words"
            shikiTheme={["github-dark-dimmed", "github-dark-dimmed"]}
          >
            {text}
          </Response>
        ) : (
          "..."
        )}
      </MessageContent>
    </Message>
  );
}
