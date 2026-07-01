import { ImageIcon } from "lucide-react";
// Fluid's message bubble; aliased to avoid colliding with the ChatMessage data type.
import { ChatMessage as ChatBubble } from "@repo/ui/components/chat-message";
import { Response } from "@repo/ui/components/ai-elements/response";
import { Shimmer } from "@repo/ui/components/ai-elements/shimmer";

import { getBridge } from "@repo/app/lib/bridge";
import type { ChatMessage } from "@repo/app/stores/agent-store";
import { isRecord } from "@repo/core/ipc";

// Hoisted so the array reference is stable across renders.
const ASSISTANT_SHIKI_THEME: ["github-dark-dimmed", "github-dark-dimmed"] = [
  "github-dark-dimmed",
  "github-dark-dimmed",
];

export function ChatMessageView({ message }: { message: ChatMessage }) {
  const first = message.parts[0];
  if (!first) return null;

  // Tool calls are never rendered as bubbles. While the turn is live, a single
  // <ChatActivityRow> below the message list shows the current activity as a
  // rolling shimmer line; on agent_end the store sweeps these messages so
  // only the user prompt and final assistant answer remain.
  if (first.type === "dynamic-tool") return null;

  if (first.type !== "text") return null;

  const text = first.text;
  const imageCount = message.metadata?.imageCount ?? 0;

  if (message.metadata?.steer) {
    return <SteerMessage text={text} imageCount={imageCount} />;
  }
  if (message.metadata?.errorKind) {
    return <ErrorMessage text={text} kind={message.metadata.errorKind} />;
  }
  if (message.role === "user") {
    return <UserMessage text={text} imageCount={imageCount} />;
  }
  return <AssistantMessage text={text} />;
}

function ErrorMessage({ text, kind }: { text: string; kind: "auth" | "unknown" }) {
  return (
    <div className="mr-8">
      <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <span>{text}</span>
        {kind === "auth" && (
          <button
            type="button"
            onClick={() => void getBridge()?.reauthenticate()}
            className="self-start text-[10px] underline underline-offset-2 hover:text-destructive/80"
          >
            Re-authenticate
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Single shimmer line that reflects what the agent is currently doing. Renders
 * nothing when not busy. While busy:
 *   - Latest running tool      → "<toolName> · <args>"
 *   - Latest tool done, more work likely → "Thinking…" (next step pending)
 *   - No tools yet              → "Thinking…"
 *   - Assistant text streaming  → "Finalizing answer"
 *
 * Visible only on the live turn; the answer that lands replaces it.
 */
export function ChatActivityRow({ messages, busy }: { messages: ChatMessage[]; busy: boolean }) {
  if (!busy) return null;

  // Walk from the end: the latest text/tool message reflects the current step.
  let label = "Thinking";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const part = m?.parts[0];
    if (!part) continue;
    if (part.type === "dynamic-tool") {
      if (part.state === "input-available" || part.state === "input-streaming") {
        const args = formatToolArgs(part.input);
        label = args ? `${part.toolName} · ${args}` : part.toolName;
      }
      break;
    }
    if (part.type === "text" && m.role === "assistant" && part.text) {
      label = "Finalizing answer";
      break;
    }
  }

  return (
    <div className="px-3 py-1 text-xs italic">
      <Shimmer duration={1.5}>{label}</Shimmer>
    </div>
  );
}

function UserMessage({ text, imageCount }: { text: string; imageCount: number }) {
  return (
    <ChatBubble from="user" className="text-xs">
      {text && <span>{text}</span>}
      <ImageCount count={imageCount} withLabel />
    </ChatBubble>
  );
}

function SteerMessage({ text, imageCount }: { text: string; imageCount: number }) {
  return (
    <div className="ml-8">
      <div className="rounded-md px-3 py-1.5 text-xs italic text-muted-foreground backdrop-blur-sm">
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
  // Empty text is the brief gap between message_start and either the first
  // tool call or the first text delta — render nothing. The compact tool
  // rows downstream are the active "agent is working" signal; doubling up
  // with a bubble shimmer makes the UI feel noisy.
  if (!text) return null;
  return (
    <ChatBubble from="assistant">
      <Response
        className="prose prose-sm max-w-none break-words text-xs dark:prose-invert [&_*]:text-xs"
        shikiTheme={ASSISTANT_SHIKI_THEME}
      >
        {text}
      </Response>
    </ChatBubble>
  );
}

// Best-effort one-line preview of the tool's input. Shape varies by tool —
// some pass `{ command, args }` (agent-browser), some pass `{ path }` (read),
// some pass arbitrary JSON. Keep it short; the renderer truncates wider lines.
const MAX_ARGS_LEN = 120;
function formatToolArgs(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return truncate(input, MAX_ARGS_LEN);
  if (!isRecord(input)) return truncate(String(input), MAX_ARGS_LEN);

  // Prioritised keys that read well as a one-line subtitle.
  for (const key of ["command", "query", "path", "url", "file", "name", "text"]) {
    const value = input[key];
    if (typeof value === "string" && value) return truncate(value, MAX_ARGS_LEN);
  }
  // agent-browser's `args: string[]` — render as a space-joined preview.
  if (Array.isArray(input["args"])) {
    const joined = input["args"].filter((v) => typeof v === "string").join(" ");
    if (joined) return truncate(joined, MAX_ARGS_LEN);
  }
  // Fallback: compact JSON of the whole input.
  try {
    return truncate(JSON.stringify(input), MAX_ARGS_LEN);
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
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
