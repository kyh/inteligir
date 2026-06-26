import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  ListPlusIcon,
  PaperclipIcon,
  SquareIcon,
  SunriseIcon,
  ZapIcon,
} from "lucide-react";
import { motion, type Transition, type Variants } from "motion/react";
import { cn } from "@repo/ui/lib/utils";
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
const COMPOSER_COLLAPSED_WIDTH = 270;
const COMPOSER_EXPANDED_WIDTH = 608;

type ComposerMotionState = "collapsed" | "expanded";

const dockTransition: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 38,
  mass: 0.8,
};

const quickFadeTransition: Transition = {
  duration: 0.16,
  ease: "easeOut",
};

const gradientDriftTransition: Transition = {
  duration: 6.5,
  repeat: Infinity,
  repeatType: "mirror",
  ease: "easeInOut",
};

const widthVariants: Variants = {
  collapsed: { width: COMPOSER_COLLAPSED_WIDTH },
  expanded: { width: COMPOSER_EXPANDED_WIDTH },
};

const promptVariants: Variants = {
  collapsed: { opacity: 1, x: 0, transition: quickFadeTransition },
  expanded: { opacity: 0, x: -8, transition: quickFadeTransition },
};

const rowVariants: Variants = {
  collapsed: { opacity: 0, y: 0, transition: quickFadeTransition },
  expanded: { opacity: 1, y: 0, transition: quickFadeTransition },
};

const gradientVariants: Variants = {
  collapsed: {
    opacity: 0.22,
    width: 150,
    x: [-18, -8, -18],
    transition: {
      opacity: quickFadeTransition,
      width: dockTransition,
      x: gradientDriftTransition,
    },
  },
  expanded: {
    opacity: 0.16,
    width: 190,
    x: 2,
    transition: {
      opacity: quickFadeTransition,
      width: dockTransition,
      x: dockTransition,
    },
  },
};

// Extract the base64 payload from a `data:<mime>;base64,<payload>` URL.
// Returns null for any other URL shape — including blob: URLs that came
// through when PromptInput's blob → data URL conversion failed, and
// non-base64 data URLs (e.g. `data:text/plain,hello`) — so the agent never
// receives a non-base64 string in the `data` field.
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

function relatedTargetIsInside(currentTarget: HTMLElement, relatedTarget: EventTarget | null) {
  return relatedTarget instanceof Node && currentTarget.contains(relatedTarget);
}

export function Composer({
  className,
  trailing,
}: {
  className?: string;
  // Extra controls (e.g. the voice mic) rendered inside the pill, to the left
  // of the submit button. The dock injects these so everything lives in one
  // single-line bar instead of a sibling button outside the frosted pill.
  trailing?: ReactNode;
}) {
  const [hasInput, setHasInput] = useState(false);
  const [hasAttachments, setHasAttachments] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
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
        const fileImages = message.files.filter(isImagePromptInputFile);
        if (!text && fileImages.length === 0) return;

        const converted = fileImages.map((f) => dataUrlToImageAttachment(f.url, f.mediaType));
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

  const onAttachError = useCallback((err: { code: string; message: string }) => {
    console.warn(`[composer] attachment error: ${err.code} - ${err.message}`);
  }, []);

  const queueCount = queuedFollowUp.length + queuedSteering.length;
  const hasContent = hasInput || hasAttachments;
  const expanded = hovered || focused || hasContent;
  const motionState: ComposerMotionState = expanded ? "expanded" : "collapsed";
  const steeringQueue = useMemo(() => keyedMessages("steer", queuedSteering), [queuedSteering]);
  const followUpQueue = useMemo(() => keyedMessages("follow", queuedFollowUp), [queuedFollowUp]);
  const requestSteer = useCallback(() => {
    pendingSteerRef.current = true;
  }, []);
  const handleBlurCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (relatedTargetIsInside(e.currentTarget, e.relatedTarget)) return;
    setFocused(false);
  }, []);

  return (
    <motion.div
      ref={wrapperRef}
      className={cn(
        "composer-shell flex flex-col gap-2",
        expanded && "composer-expanded",
        hasContent && "composer-has-content",
        className,
      )}
      initial={false}
      animate={motionState}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={handleBlurCapture}
    >
      {queueCount > 0 && (
        // Smoked-glass chip above the bar (smaller radius than the composer).
        // Composed from the glass tokens instead of the glass-smoke utility so
        // twMerge deterministically replaces Queue's own bg/border/shadow.
        <Queue className="rounded-[16px] border-transparent bg-glass-smoke px-1.5 pb-1 pt-1 text-glass-fg shadow-[var(--glass-shadow)] backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]">
          <QueueList className="-mb-1 mt-0">
            {steeringQueue.map((msg) => (
              <QueueItem
                key={msg.key}
                className="rounded-[10px] px-2 py-1 hover:bg-glass-row"
                title={msg.text}
              >
                <div className="flex items-center gap-1.5 text-[10px] text-glass-fg">
                  <ZapIcon className="size-2.5 shrink-0 text-yellow-500" />
                  <QueueItemContent className="text-glass-fg">{msg.text}</QueueItemContent>
                </div>
              </QueueItem>
            ))}
            {followUpQueue.map((msg) => (
              <QueueItem
                key={msg.key}
                className="rounded-[10px] px-2 py-1 hover:bg-glass-row"
                title={msg.text}
              >
                <div className="flex items-center gap-1.5 text-[10px]">
                  <QueueItemIndicator className="size-1.5" />
                  <QueueItemContent className="text-glass-fg">{msg.text}</QueueItemContent>
                </div>
              </QueueItem>
            ))}
          </QueueList>
        </Queue>
      )}

      <motion.div
        className="composer-motion-wrap"
        initial={false}
        animate={motionState}
        variants={widthVariants}
        transition={dockTransition}
      >
        <PromptInput
          accept={ACCEPTED_IMAGE_MIME}
          multiple
          maxFiles={MAX_ATTACHMENT_COUNT}
          maxFileSize={MAX_ATTACHMENT_BYTES}
          onError={onAttachError}
          onSubmit={handleSubmit}
          className="composer-form [&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-[var(--radius-glass)] [&_[data-slot=input-group]]:border-[rgba(0,0,0,0.05)] [&_[data-slot=input-group]]:glass-mist [&_[data-slot=input-group]]:px-0 [&_[data-slot=input-group]]:py-0 [&_[data-slot=input-group]]:[--focus-ring:transparent] [&_[data-slot=input-group]]:shadow-[var(--mist-shadow)] [&_[data-slot=input-group]]:transition-none"
        >
          <motion.div
            className="composer-gradient"
            aria-hidden="true"
            initial={false}
            animate={motionState}
            variants={gradientVariants}
          />
          <motion.div
            className="composer-collapsed-prompt"
            aria-hidden="true"
            initial={false}
            animate={motionState}
            variants={promptVariants}
          >
            <SunriseIcon className="size-5 shrink-0" strokeWidth={2.4} />
            <span>What do you wanna create today?</span>
          </motion.div>
          <ComposerAttachments onHasAttachmentsChange={setHasAttachments} />
          <motion.div
            className={cn(
              "composer-input-row flex min-h-8 items-center gap-2",
              expanded ? "pointer-events-auto" : "pointer-events-none",
            )}
            initial={false}
            animate={motionState}
            variants={rowVariants}
          >
            <AttachButton />
            <ComposerTextarea busy={busy} onInterrupt={interrupt} onHasInputChange={setHasInput} />
            {trailing}
            <SteerButton busy={busy} hasInput={hasInput} onSteer={requestSteer} />
            <SubmitOrStop busy={busy} hasInput={hasInput} onInterrupt={interrupt} />
          </motion.div>
        </PromptInput>
      </motion.div>
    </motion.div>
  );
}

function AttachButton() {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton
      tooltip="Attach image"
      onClick={openFileDialog}
      className="h-7 shrink-0 gap-1 rounded-[18px] px-2 text-[13px] text-glass-fg-muted transition-[color,background-color,transform] hover:-translate-y-0.5 hover:bg-white/5 hover:text-glass-fg"
    >
      <PaperclipIcon className="size-3.5" />
      Attach
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
        // Use the form's reset path (same one PromptInput uses on submit)
        // instead of poking the DOM value directly so the field clear is
        // consistent across both paths.
        e.currentTarget.form?.reset();
        onHasInputChange(false);
      }
      if (files.length > 0) clear();
    },
    [busy, onInterrupt, onHasInputChange, files.length, clear],
  );

  return (
    <PromptInputTextarea
      // Starts as a single line and grows as text wraps. White text + caret in
      // BOTH themes — the glass underneath is always dark.
      className="max-h-[120px] min-h-7 min-w-0 flex-1 px-1 py-1.5 text-[13px] leading-4 text-glass-fg caret-white placeholder:text-white/30"
      placeholder={busy ? "Queue message..." : "What do you wanna create today?"}
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
      className="size-7 shrink-0 rounded-full text-glass-fg-muted transition-[color,background-color,transform] hover:-translate-y-0.5 hover:bg-glass-row hover:text-glass-fg"
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

  // The send/stop circle is a lighter translucent pill on the glass (refs),
  // not an inverted solid — variant="ghost" keeps the Button's own opaque
  // background layer out of the way so the glass-row fill shows.
  if (busy && !hasContent) {
    return (
      <PromptInputButton
        tooltip="Stop"
        onClick={onInterrupt}
        className="size-7 shrink-0 rounded-full bg-glass-row-active text-white transition-[color,background-color,transform] hover:-translate-y-0.5 hover:bg-white/40 hover:text-white"
      >
        <SquareIcon className="size-4" />
      </PromptInputButton>
    );
  }

  return (
    <PromptInputSubmit
      variant="ghost"
      disabled={!hasContent}
      aria-label={busy ? "Queue for next turn" : "Send"}
      className="size-7 shrink-0 rounded-full bg-glass-row-active text-white transition-[color,background-color,transform] hover:-translate-y-0.5 hover:bg-white/40 hover:text-white disabled:bg-glass-row disabled:text-white/40 disabled:hover:translate-y-0"
    >
      {busy ? <ListPlusIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
    </PromptInputSubmit>
  );
}

function ComposerAttachments({
  onHasAttachmentsChange,
}: {
  onHasAttachmentsChange: (hasAttachments: boolean) => void;
}) {
  const { files, remove } = usePromptInputAttachments();
  useEffect(() => {
    onHasAttachmentsChange(files.length > 0);
  }, [files.length, onHasAttachmentsChange]);

  if (files.length === 0) return null;
  return (
    <Attachments variant="grid" className="px-2 pb-1 pt-1">
      {files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => remove(file.id)}
          className="size-9 rounded-lg border border-white/15"
        >
          <AttachmentPreview />
          <AttachmentRemove className="size-4 top-0 right-0 rounded-none rounded-bl bg-black/60 text-white [&>svg]:size-2.5" />
        </Attachment>
      ))}
    </Attachments>
  );
}
