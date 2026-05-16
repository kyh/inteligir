import type { DynamicToolUIPart } from "ai";
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

// Hoisted so the array reference is stable across renders — the previous
// inline literal allocated a new array every cycle. Response's memo doesn't
// inspect this prop today, but a stable ref future-proofs the render path.
const ASSISTANT_SHIKI_THEME: ["github-dark-dimmed", "github-dark-dimmed"] = [
  "github-dark-dimmed",
  "github-dark-dimmed",
];

export function ChatMessageView({ message }: { message: ChatMessage }) {
  const first = message.parts[0];
  if (!first) return null;

  if (first.type === "dynamic-tool") {
    return <ToolMessage part={first} />;
  }
  if (first.type !== "text") return null;

  const text = first.text;
  const imageCount = message.metadata?.imageCount ?? 0;

  if (message.metadata?.steer) {
    return <SteerMessage text={text} imageCount={imageCount} />;
  }
  if (message.role === "user") {
    return <UserMessage text={text} imageCount={imageCount} />;
  }
  return <AssistantMessage text={text} />;
}

function UserMessage({ text, imageCount }: { text: string; imageCount: number }) {
  return (
    <Message from="user">
      <MessageContent>
        {text && <span>{text}</span>}
        <ImageCount count={imageCount} withLabel />
      </MessageContent>
    </Message>
  );
}

function SteerMessage({ text, imageCount }: { text: string; imageCount: number }) {
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

function AssistantMessage({ text }: { text: string }) {
  return (
    <Message from="assistant">
      <MessageContent>
        {text ? (
          <Response
            className="prose prose-sm prose-invert max-w-none break-words"
            shikiTheme={ASSISTANT_SHIKI_THEME}
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

function ToolMessage({ part }: { part: DynamicToolUIPart }) {
  const { state } = part;
  const hasOutput = state === "output-available" || state === "output-error";
  return (
    <div className="mr-8">
      <Tool className="bg-foreground/5 backdrop-blur-sm">
        <ToolHeader
          type="dynamic-tool"
          toolName={part.toolName}
          state={state as ToolPart["state"]}
        />
        {hasOutput && (
          <ToolContent>
            <ToolOutput
              output={state === "output-available" ? (part.output as unknown) : undefined}
              errorText={state === "output-error" ? part.errorText : undefined}
            />
          </ToolContent>
        )}
      </Tool>
    </div>
  );
}

function ImageCount({ count, withLabel }: { count: number; withLabel?: boolean }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <ImageIcon className="size-3" />
      {withLabel ? `${count} image${count === 1 ? "" : "s"}` : count}
    </span>
  );
}
