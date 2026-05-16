import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, ListPlusIcon, SendIcon, SquareIcon, ZapIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@repo/ui/components/ai-elements/attachments";
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
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
} from "@repo/ui/components/ai-elements/queue";

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

// Extract the base64 payload from a `data:<mime>;base64,<payload>` URL.
// Returns null for any other URL shape — including blob: URLs that came
// through when PromptInput's blob → data URL conversion failed, and
// non-base64 data URLs (e.g. `data:text/plain,hello`) — so the agent never
// receives a non-base64 string in the `data` field.
function dataUrlToImageAttachment(
  url: string,
  mimeType: string,
): ImageAttachment | null {
  if (!url.startsWith("data:")) return null;
  const marker = ";base64,";
  const markerIdx = url.indexOf(marker);
  if (markerIdx < 0) return null;
  const data = url.slice(markerIdx + marker.length);
  if (!data) return null;
  return { data, mimeType: mimeType || "image/png" };
}

export function Composer() {
  const [hasInput, setHasInput] = useState(false);
  // UI-local signal that the user clicked the Zap button. Consumed once on
  // the next submit; cleared on agent_end so an unsubmitted Zap doesn't
  // silently steer a future turn.
  const pendingSteerRef = useRef(false);
  // Ref to the composer's outer div so we can query the textarea after the
  // async file-conversion gap inside PromptInput — event.currentTarget is
  // not safe to read across that gap in React's synthetic event model.
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const appState = useAgentStore((s) => s.appState);
  const send = useAgentStore((s) => s.send);
  const interrupt = useAgentStore((s) => s.interrupt);
  const queuedFollowUp = useAgentStore((s) => s.queuedFollowUp);
  const queuedSteering = useAgentStore((s) => s.queuedSteering);

  const busy = appState.phase === "ready" && appState.agent === "busy";
  const sessionStatus = getSessionStatus(appState);

  useEffect(() => {
    if (!busy) pendingSteerRef.current = false;
  }, [busy]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      // Don't blanket-clear hasInput: PromptInput's blob-conversion gap lets
      // the user type into the (now-reset) textarea, and a top-of-handler
      // setHasInput(false) would clobber that fresh onChange. Re-sync from
      // the actual textarea DOM in a finally so every exit path leaves
      // hasInput consistent with what's really in the field.
      // The wrapper ref is used (not event.currentTarget) because React
      // nullifies the synthetic event after the synchronous handler returns,
      // and our handler is invoked across PromptInput's async file
      // conversion gap.
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
        const fileImages = message.files.filter(
          (f) => f.mediaType?.startsWith("image/") && f.url,
        );
        if (!text && fileImages.length === 0) return;

        const converted = fileImages.map((f) =>
          dataUrlToImageAttachment(f.url!, f.mediaType ?? "image/png"),
        );
        const images = converted.filter((img): img is ImageAttachment => img !== null);
        const dropped = converted.length - images.length;
        if (dropped > 0) {
          console.warn(
            `[composer] dropped ${dropped} attachment(s) that failed blob → data URL conversion`,
          );
        }
        // If every attachment failed to convert and there's no text, throw so
        // PromptInput's catch block skips clear() — keeps the original files
        // in the tray for the user to retry instead of silently discarding them.
        if (!text && images.length === 0) {
          throw new Error("composer: nothing to submit after attachment conversion");
        }

        send(
          text,
          images.length > 0 ? images : undefined,
          wantsSteer ? { intent: "steer" } : undefined,
        );
      } finally {
        syncHasInputFromDOM();
      }
    },
    [send],
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
    <div ref={wrapperRef} className="bg-foreground/8 px-3 py-2 backdrop-blur-sm">
      {queueCount > 0 && (
        <Queue className="mb-2 rounded-md bg-foreground/5 px-1.5 pb-1 pt-1 shadow-none">
          <QueueList className="-mb-1 mt-0">
            {queuedSteering.map((msg, i) => (
              <QueueItem key={`s-${i}`} className="px-2 py-1" title={msg}>
                <div className="flex items-center gap-1.5 text-[10px] text-foreground">
                  <ZapIcon className="size-2.5 shrink-0 text-yellow-500" />
                  <QueueItemContent className="text-foreground">{msg}</QueueItemContent>
                </div>
              </QueueItem>
            ))}
            {queuedFollowUp.map((msg, i) => (
              <QueueItem key={`f-${i}`} className="px-2 py-1" title={msg}>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <QueueItemIndicator className="size-1.5" />
                  <QueueItemContent>{msg}</QueueItemContent>
                </div>
              </QueueItem>
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
      // Focus on mount so users can start typing immediately.
      autoFocus
      className="min-h-10 text-xs"
      placeholder={busy ? "Queue message..." : "Message..."}
      onChange={(e) => onHasInputChange(e.currentTarget.value.trim().length > 0)}
      onKeyDown={handleKeyDown}
    />
  );
}

// Text in the textarea or files in the attachments tray.
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
      // type="button" (not "submit") so PromptInputSubmit stays the only
      // [type=submit] in the form — keeps the Enter handler's disabled-check
      // unambiguous and lets us mark steer-intent before submitting.
      type="button"
      tooltip="Send now (steer the agent)"
      onClick={(e) => {
        onSteer();
        e.currentTarget.form?.requestSubmit();
      }}
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
  const hasContent = useHasContent(hasInput);

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
    <Attachments variant="grid" className="px-2 pt-2">
      {files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => remove(file.id)}
          className="size-12 rounded border border-border"
        >
          <AttachmentPreview />
          <AttachmentRemove className="size-4 top-0 right-0 rounded-none rounded-bl bg-background/80 [&>svg]:size-2.5" />
        </Attachment>
      ))}
    </Attachments>
  );
}
