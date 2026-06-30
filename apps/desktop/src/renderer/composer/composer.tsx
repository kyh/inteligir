import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpIcon, ListPlusIcon, PaperclipIcon, SquareIcon, ZapIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { toast } from "@repo/ui/components/sonner";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@repo/ui/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@repo/ui/components/ai-elements/prompt-input";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
} from "@repo/ui/components/ai-elements/queue";

import type { ImageAttachment } from "@/shared/voice";
import { useAgentStore } from "@/renderer/stores/agent-store";

const ACCEPTED_IMAGE_MIME = "image/png,image/jpeg,image/gif,image/webp";
const MAX_ATTACHMENT_COUNT = 8;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MiB per image

// Extract the base64 payload from a `data:<mime>;base64,<payload>` URL. Returns
// null for any other shape so the agent never receives a non-base64 `data`.
function dataUrlToImageAttachment(url: string, mimeType: string): ImageAttachment | null {
  if (!url.startsWith("data:")) return null;
  const marker = ";base64,";
  const markerIdx = url.indexOf(marker);
  if (markerIdx < 0) return null;
  const data = url.slice(markerIdx + marker.length);
  if (!data) return null;
  return { data, mimeType: mimeType || "image/png" };
}

type PromptInputFile = PromptInputMessage["files"][number];
type ImagePromptInputFile = PromptInputFile & { mediaType: string; url: string };

function isImagePromptInputFile(file: PromptInputFile): file is ImagePromptInputFile {
  return (
    typeof file.url === "string" &&
    file.url.length > 0 &&
    typeof file.mediaType === "string" &&
    file.mediaType.startsWith("image/")
  );
}

type QueuedMessage = { key: string; text: string };
function keyedMessages(prefix: string, messages: string[]): QueuedMessage[] {
  const seen = new Map<string, number>();
  return messages.map((text) => {
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return { key: `${prefix}-${count}-${text}`, text };
  });
}

// One queued message row — steering and follow-up differ only by the leading icon.
function QueuedRow({ msg, icon }: { msg: QueuedMessage; icon: ReactNode }) {
  return (
    <QueueItem className="rounded-md px-2 py-1 hover:bg-muted" title={msg.text}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <QueueItemContent>{msg.text}</QueueItemContent>
      </div>
    </QueueItem>
  );
}

/**
 * The AI composer — a flat bordered card pinned at the bottom of the workspace.
 * Talks to the agent via agent-store (routing user/follow-up/steer by live busy
 * state) and auto-attaches the open note as context.
 */
export function Composer({ className }: { className?: string }) {
  const [hasInput, setHasInput] = useState(false);
  const pendingSteerRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const appState = useAgentStore((s) => s.appState);
  const send = useAgentStore((s) => s.send);
  const interrupt = useAgentStore((s) => s.interrupt);
  const queuedFollowUp = useAgentStore((s) => s.queuedFollowUp);
  const queuedSteering = useAgentStore((s) => s.queuedSteering);

  const busy = appState.phase === "ready" && appState.agent === "busy";

  useEffect(() => {
    if (!busy) pendingSteerRef.current = false;
  }, [busy]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const syncHasInputFromDOM = () => {
        const ta = wrapperRef.current?.querySelector<HTMLTextAreaElement>(
          'textarea[name="message"]',
        );
        setHasInput(!!(ta && ta.value.trim().length > 0));
      };
      const wantsSteer = pendingSteerRef.current;
      pendingSteerRef.current = false;
      try {
        const text = message.text.trim();
        const fileImages = message.files.filter(isImagePromptInputFile);
        if (!text && fileImages.length === 0) return;
        const converted = fileImages.map((f) => dataUrlToImageAttachment(f.url, f.mediaType));
        const images = converted.filter((img): img is ImageAttachment => img !== null);
        if (!text && images.length === 0) {
          throw new Error("composer: nothing to submit after attachment conversion");
        }
        // send() persists the open note and tags the turn with it; it returns
        // whether the save landed so we can warn (a failed flush means the agent
        // won't see the latest edits) — but the message still goes out.
        const { flushed } = await send(
          text,
          images.length > 0 ? images : undefined,
          wantsSteer ? { intent: "steer" } : undefined,
        );
        if (!flushed) {
          toast.warning("Couldn't save your latest edits — the agent won't see them this turn.");
        }
      } finally {
        syncHasInputFromDOM();
      }
    },
    [send],
  );

  const onAttachError = useCallback((err: { code: string; message: string }) => {
    console.warn(`[composer] attachment error: ${err.code} - ${err.message}`);
  }, []);

  const steeringQueue = keyedMessages("steer", queuedSteering);
  const followUpQueue = keyedMessages("follow", queuedFollowUp);
  const requestSteer = useCallback(() => {
    pendingSteerRef.current = true;
  }, []);

  return (
    <div ref={wrapperRef} className={cn("flex flex-col gap-1.5", className)}>
      {steeringQueue.length + followUpQueue.length > 0 && (
        <Queue className="rounded-lg border border-border bg-card px-1.5 py-1 text-card-foreground shadow-xs">
          <QueueList className="mt-0 -mb-1">
            {steeringQueue.map((msg) => (
              <QueuedRow
                key={msg.key}
                msg={msg}
                icon={<ZapIcon className="size-3 shrink-0 text-primary" />}
              />
            ))}
            {followUpQueue.map((msg) => (
              <QueuedRow
                key={msg.key}
                msg={msg}
                icon={<QueueItemIndicator className="size-1.5" />}
              />
            ))}
          </QueueList>
        </Queue>
      )}

      <PromptInput
        accept={ACCEPTED_IMAGE_MIME}
        multiple
        maxFiles={MAX_ATTACHMENT_COUNT}
        maxFileSize={MAX_ATTACHMENT_BYTES}
        onError={onAttachError}
        onSubmit={handleSubmit}
        className="rounded-xl border border-border bg-card shadow-sm [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border-transparent [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:px-0 [&_[data-slot=input-group]]:py-0 [&_[data-slot=input-group]]:shadow-none"
      >
        <ComposerAttachments />
        {/* Two-row layout (the InputGroup block-end pattern): the textarea owns
         * the top row full-width, a toolbar sits beneath with attach pinned left
         * and steer/send pinned right — so the controls stay aligned regardless
         * of how tall the textarea grows. */}
        <ComposerTextarea busy={busy} onInterrupt={interrupt} onHasInputChange={setHasInput} />
        <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5">
          <AttachButton />
          <div className="flex items-center gap-1">
            <SteerButton busy={busy} hasInput={hasInput} onSteer={requestSteer} />
            <SubmitOrStop busy={busy} hasInput={hasInput} onInterrupt={interrupt} />
          </div>
        </div>
      </PromptInput>
    </div>
  );
}

function AttachButton() {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton
      tooltip="Attach image"
      onClick={openFileDialog}
      className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <PaperclipIcon className="size-4" />
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
      if (e.currentTarget.value.length > 0) {
        e.currentTarget.form?.reset();
        onHasInputChange(false);
      }
      if (files.length > 0) clear();
    },
    [busy, onInterrupt, onHasInputChange, files.length, clear],
  );
  return (
    <PromptInputTextarea
      className="max-h-[160px] min-h-9 w-full bg-transparent px-3 pt-3 pb-1 text-sm leading-5 text-foreground placeholder:text-muted-foreground"
      placeholder={busy ? "Queue a message…" : "Ask the agent to edit your notes…"}
      onChange={(e) => onHasInputChange(e.currentTarget.value.trim().length > 0)}
      onKeyDown={handleKeyDown}
    />
  );
}

function useHasContent(hasInput: boolean): boolean {
  const { files } = usePromptInputAttachments();
  return hasInput || files.length > 0;
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
  const hasContent = useHasContent(hasInput);
  if (!busy || !hasContent) return null;
  return (
    <PromptInputButton
      type="button"
      tooltip="Send now (steer the agent)"
      onClick={(e) => {
        onSteer();
        e.currentTarget.form?.requestSubmit();
      }}
      className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ZapIcon className="size-4" />
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
  const hasContent = useHasContent(hasInput);
  if (busy && !hasContent) {
    return (
      <PromptInputButton
        tooltip="Stop"
        onClick={onInterrupt}
        className="size-8 shrink-0 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <SquareIcon className="size-4" />
      </PromptInputButton>
    );
  }
  return (
    <PromptInputSubmit
      disabled={!hasContent}
      aria-label={busy ? "Queue for next turn" : "Send"}
      className="size-8 shrink-0 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
    >
      {busy ? <ListPlusIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
    </PromptInputSubmit>
  );
}

function ComposerAttachments() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;
  return (
    <Attachments variant="grid" className="px-2 pt-2 pb-1">
      {files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => remove(file.id)}
          className="size-9 rounded-lg border border-border"
        >
          <AttachmentPreview />
          <AttachmentRemove className="top-0 right-0 size-4 rounded-none rounded-bl bg-foreground/60 text-background [&>svg]:size-2.5" />
        </Attachment>
      ))}
    </Attachments>
  );
}
