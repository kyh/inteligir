import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, ListPlusIcon, SendIcon, SquareIcon, XIcon, ZapIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@repo/ui/components/ai-elements/prompt-input";

import type { ImageAttachment } from "@/shared/voice";
import { getSessionStatus, type SessionStatus } from "@/shared/agent";
import { useAgentStore } from "@/renderer/stores/agent-store";

const statusColors: Record<SessionStatus, string> = {
  idle: "bg-green-400",
  busy: "bg-yellow-400 animate-pulse",
  error: "bg-red-400",
  starting: "bg-blue-400 animate-pulse",
};

const ACCEPTED_IMAGE_MIME = "image/png,image/jpeg,image/gif,image/webp";
const MAX_ATTACHMENT_COUNT = 8;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MiB per image

async function dataUrlToImageAttachment(url: string, mimeType: string): Promise<ImageAttachment> {
  const commaIdx = url.indexOf(",");
  const data = commaIdx >= 0 ? url.slice(commaIdx + 1) : url;
  return { data, mimeType: mimeType || "image/png" };
}

export function Composer() {
  // PromptInput is uncontrolled by default. We track text presence via the
  // textarea onChange and image presence via children that subscribe to the
  // attachments context. The steer-intent flag is set immediately before the
  // user-initiated submit and consumed inside handleSubmit. It's a ref so the
  // onClick handler that sets it and the form submit that reads it run in the
  // same React event tick without a stale closure.
  const [hasInput, setHasInput] = useState(false);
  const pendingSteerRef = useRef(false);

  const appState = useAgentStore((s) => s.appState);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const followUp = useAgentStore((s) => s.followUp);
  const interrupt = useAgentStore((s) => s.interrupt);
  const queuedFollowUp = useAgentStore((s) => s.queuedFollowUp);
  const queuedSteering = useAgentStore((s) => s.queuedSteering);

  const busy = appState.phase === "ready" && appState.agent === "busy";
  const sessionStatus = getSessionStatus(appState);

  // If we leave the busy state without submitting, drop any leftover steer
  // intent so it doesn't silently steer the next turn.
  useEffect(() => {
    if (!busy) pendingSteerRef.current = false;
  }, [busy]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      // PromptInput already called form.reset() before invoking us, so the
      // textarea is visually empty. Clear hasInput unconditionally to keep
      // the submit/steer button state in sync — including on early-return
      // for whitespace-only submits.
      setHasInput(false);

      const text = message.text.trim();
      const fileImages = message.files.filter(
        (f) => f.mediaType?.startsWith("image/") && f.url,
      );
      if (!text && fileImages.length === 0) return;

      const images: ImageAttachment[] = await Promise.all(
        fileImages.map(async (f) => dataUrlToImageAttachment(f.url!, f.mediaType ?? "image/png")),
      );
      const imgs = images.length > 0 ? images : undefined;

      const shouldSteer = busy && pendingSteerRef.current;
      pendingSteerRef.current = false;

      if (shouldSteer) {
        steer(text, imgs);
      } else if (busy) {
        followUp(text, imgs);
      } else {
        sendMessage(text, imgs);
      }
    },
    [busy, steer, followUp, sendMessage],
  );

  const onAttachError = useCallback(
    (err: { code: string; message: string }) => {
      console.warn(`[composer] attachment error: ${err.code} - ${err.message}`);
    },
    [],
  );

  const queueCount = queuedFollowUp.length + queuedSteering.length;
  const requestSteer = useCallback(() => {
    pendingSteerRef.current = true;
  }, []);

  return (
    <div className="bg-foreground/8 px-3 py-2 backdrop-blur-sm">
      {queueCount > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {queuedSteering.map((msg, i) => (
            <div
              key={`s-${i}`}
              className="flex items-center gap-1.5 truncate rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-[10px] text-foreground"
              title={msg}
            >
              <ZapIcon className="size-2.5 shrink-0" />
              <span className="truncate">{msg}</span>
            </div>
          ))}
          {queuedFollowUp.map((msg, i) => (
            <div
              key={`f-${i}`}
              className="truncate rounded border border-foreground/20 bg-foreground/5 px-2 py-1 text-[10px] text-muted-foreground"
              title={msg}
            >
              {msg}
            </div>
          ))}
        </div>
      )}

      <PromptInput
        accept={ACCEPTED_IMAGE_MIME}
        multiple
        maxFiles={MAX_ATTACHMENT_COUNT}
        maxFileSize={MAX_ATTACHMENT_BYTES}
        onError={onAttachError}
        onSubmit={handleSubmit}
        className="rounded-2xl border-foreground/10 bg-foreground/5 backdrop-blur-sm"
      >
        <PromptInputBody>
          <ComposerAttachments />
          <ComposerTextarea
            busy={busy}
            onInterrupt={interrupt}
            onHasInputChange={setHasInput}
          />
          <PromptInputToolbar>
            <PromptInputTools>
              <span
                className={cn(
                  "ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  statusColors[sessionStatus],
                )}
              />
              <AttachButton />
              <SteerButton busy={busy} hasInput={hasInput} onSteer={requestSteer} />
            </PromptInputTools>
            <SubmitOrStop busy={busy} hasInput={hasInput} onInterrupt={interrupt} />
          </PromptInputToolbar>
        </PromptInputBody>
      </PromptInput>
    </div>
  );
}

function AttachButton() {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton tooltip="Attach image" onClick={openFileDialog}>
      <ImageIcon className="size-3.5" />
    </PromptInputButton>
  );
}

function ComposerTextarea({
  busy,
  onInterrupt,
  onHasInputChange,
}: {
  busy: boolean;
  onInterrupt: () => void;
  onHasInputChange: (has: boolean) => void;
}) {
  const { files, clear } = usePromptInputAttachments();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (busy) {
        onInterrupt();
        return;
      }
      const hasText = e.currentTarget.value.length > 0;
      if (hasText) {
        e.currentTarget.value = "";
        onHasInputChange(false);
      }
      if (files.length > 0) clear();
    },
    [busy, onInterrupt, onHasInputChange, files.length, clear],
  );

  return (
    <PromptInputTextarea
      className="min-h-10 text-xs"
      placeholder={busy ? "Queue message..." : "Message..."}
      onChange={(e) => onHasInputChange(e.currentTarget.value.length > 0)}
      onKeyDown={handleKeyDown}
    />
  );
}

function SteerButton({
  busy,
  hasInput,
  onSteer,
}: {
  busy: boolean;
  hasInput: boolean;
  onSteer: () => void;
}) {
  const { files } = usePromptInputAttachments();
  const hasContent = hasInput || files.length > 0;
  if (!busy || !hasContent) return null;

  return (
    <PromptInputButton
      type="submit"
      tooltip="Send now (steer the agent)"
      onClick={onSteer}
    >
      <ZapIcon className="size-3.5" />
    </PromptInputButton>
  );
}

function SubmitOrStop({
  busy,
  hasInput,
  onInterrupt,
}: {
  busy: boolean;
  hasInput: boolean;
  onInterrupt: () => void;
}) {
  const { files } = usePromptInputAttachments();
  const hasContent = hasInput || files.length > 0;

  if (busy && !hasContent) {
    return (
      <PromptInputButton tooltip="Stop" onClick={onInterrupt}>
        <SquareIcon className="size-3.5" />
      </PromptInputButton>
    );
  }

  return (
    <PromptInputSubmit
      disabled={!hasContent}
      variant="ghost"
      aria-label={busy ? "Queue for next turn" : "Send"}
    >
      {busy ? <ListPlusIcon className="size-3.5" /> : <SendIcon className="size-3.5" />}
    </PromptInputSubmit>
  );
}

function ComposerAttachments() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-2">
      {files.map((file) => (
        <div
          key={file.id}
          className="relative h-12 w-12 overflow-hidden rounded border border-border"
        >
          {file.url && file.mediaType?.startsWith("image/") ? (
            <img src={file.url} alt={file.filename ?? ""} className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center bg-muted text-[10px] text-muted-foreground">
              {file.filename}
            </div>
          )}
          <button
            type="button"
            onClick={() => remove(file.id)}
            className="absolute right-0 top-0 rounded-bl bg-background/80 p-0.5 text-foreground hover:bg-background"
            aria-label="Remove image"
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
