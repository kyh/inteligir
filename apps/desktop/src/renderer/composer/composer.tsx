import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ImageIcon,
  ListPlusIcon,
  MicIcon,
  PaperclipIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentGroup,
  AttachmentMedia,
} from "@repo/ui/components/attachment";
import {
  PromptInput,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@renderer/ai-elements/prompt-input";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
} from "@renderer/ai-elements/queue";

import type { ImageAttachment } from "@repo/features/voice";
import {
  CAPSULE_CONTENT_HIDDEN,
  CAPSULE_CONTENT_VISIBLE,
  CAPSULE_RADIUS,
  CAPSULE_SURFACE,
  ListeningGlow,
  ListeningOrb,
  useCapsuleSpring,
} from "@renderer/composer/capsule-motion";
import { useAgentStore } from "@renderer/stores/agent-store";
import { useVoiceCapture } from "@renderer/voice/use-voice-capture";

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
 * The AI composer — a spring-morphing capsule pinned at the bottom of the
 * workspace. It rests as a compact centered pill and springs open to the full
 * input on click/focus, collapsing back when the draft empties and focus
 * leaves. Talks to the agent via agent-store (routing user/follow-up/steer
 * by live busy state) and auto-attaches the open note as context. Tapping the
 * mic morphs the capsule into a listening surface driven by local STT; the
 * confirmed transcript lands in the draft for review, never auto-sent.
 */
export function Composer() {
  const [hasInput, setHasInput] = useState(false);
  // Attachment presence, lifted out of PromptInput (its onFilesChange prop) so
  // the collapse logic below can hold the capsule open while files are staged
  // even though the tray lives inside the form.
  const [hasAttachments, setHasAttachments] = useState(false);
  // User-engagement latch: set by pill click / textarea focus, cleared when
  // focus leaves the composer (the wrapper's blur handler below).
  const [engaged, setEngaged] = useState(false);
  const engage = useCallback(() => setEngaged(true), []);
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

  const findTextarea = useCallback(
    () =>
      wrapperRef.current?.querySelector<HTMLTextAreaElement>('textarea[name="message"]') ?? null,
    [],
  );

  // --- Voice capture ---------------------------------------------------------

  const voice = useVoiceCapture();
  const voiceActive = voice.phase !== "idle";

  // The capsule is expanded (full input) or resting (compact pill). `engaged`
  // is pure user intent; everything that must hold the surface open — a
  // running turn, the listening surface, drafted text, staged attachments —
  // is OR'd on top so a collapse can never eat state. When busy ends with the
  // draft empty and focus elsewhere, this falls back to the pill on its own.
  const expanded = engaged || busy || voiceActive || hasInput || hasAttachments;

  /** Confirm listening: the final transcript is appended to the draft for
   * review — never auto-sent. */
  const { confirm: confirmVoice } = voice;
  const confirmListening = useCallback(async () => {
    const text = await confirmVoice();
    if (!text) return;
    const ta = findTextarea();
    if (!ta) return;
    const existing = ta.value.replace(/\s+$/, "");
    const next = existing ? `${existing} ${text}` : text;
    ta.value = next;
    ta.setSelectionRange(next.length, next.length);
    setHasInput(next.trim().length > 0);
  }, [confirmVoice, findTextarea]);

  // Escape cancels listening (the textarea's own Escape handler is inert
  // while the input surface is hidden).
  const { cancel: cancelVoice } = voice;
  useEffect(() => {
    if (!voiceActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancelVoice();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voiceActive, cancelVoice]);

  // --- Collapse / expand -----------------------------------------------------

  // Collapse when focus truly LEAVES the composer (focusout bubbles here from
  // every descendant): moving between the textarea and toolbar buttons stays
  // inside the wrapper and must not fold the capsule. The `expanded` OR-chain
  // still holds it open if a draft, attachments, or a running turn remain.
  // Listening vetoes — the input goes inert and blurs itself as the listening
  // surface takes over, and that must not eat the engagement latch.
  const handleWrapperBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      if (voiceActive) return;
      const next = e.relatedTarget;
      if (next instanceof Node && wrapperRef.current?.contains(next)) return;
      setEngaged(false);
    },
    [voiceActive],
  );

  // Focus the textarea whenever the input becomes the active surface: on
  // expand (pill click mounts it) and on return from listening (so the
  // transcript is immediately reviewable). A cancelled pill-mic session
  // collapses back to the pill — expanded is false, nothing to focus.
  const prevSurfaceRef = useRef({ expanded, voiceActive });
  useEffect(() => {
    const prev = prevSurfaceRef.current;
    prevSurfaceRef.current = { expanded, voiceActive };
    if (expanded && !voiceActive && (!prev.expanded || prev.voiceActive)) {
      findTextarea()?.focus();
    }
  }, [expanded, voiceActive, findTextarea]);

  // --- Submission ------------------------------------------------------------

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const syncHasInputFromDOM = () => {
        const ta = findTextarea();
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
    [send, findTextarea],
  );

  const onAttachError = useCallback((err: { code: string; message: string }) => {
    console.warn(`[composer] attachment error: ${err.code} - ${err.message}`);
  }, []);

  const steeringQueue = keyedMessages("steer", queuedSteering);
  const followUpQueue = keyedMessages("follow", queuedFollowUp);
  const requestSteer = useCallback(() => {
    pendingSteerRef.current = true;
  }, []);

  const handleFilesChange = useCallback((files: PromptInputMessage["files"]) => {
    setHasAttachments(files.length > 0);
  }, []);

  const { capsule: capsuleSpring, content: contentSpring, reduceMotion } = useCapsuleSpring();

  return (
    <div ref={wrapperRef} onBlur={handleWrapperBlur} className="flex flex-col gap-1.5">
      <AnimatePresence initial={false}>
        {steeringQueue.length + followUpQueue.length > 0 && (
          <motion.div
            key="queue"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            transition={capsuleSpring}
          >
            <Queue className="rounded-2xl border-transparent bg-popover px-1.5 py-1 text-popover-foreground shadow-sm ring-1 ring-border">
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
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative">
        <AnimatePresence>{voiceActive && <ListeningGlow key="glow" />}</AnimatePresence>
        <motion.div
          layout={!reduceMotion}
          transition={capsuleSpring}
          style={{ borderRadius: CAPSULE_RADIUS }}
          className={cn(CAPSULE_SURFACE, expanded ? "w-full" : "w-fit mx-auto")}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {voiceActive && (
              <motion.div
                key="listening"
                initial={CAPSULE_CONTENT_HIDDEN}
                animate={CAPSULE_CONTENT_VISIBLE}
                exit={CAPSULE_CONTENT_HIDDEN}
                transition={contentSpring}
              >
                <ListeningRow
                  transcript={voice.transcript}
                  stopping={voice.phase === "stopping"}
                  onCancel={cancelVoice}
                  onConfirm={() => void confirmListening()}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Resting, the capsule is a compact pill; engaging (click/focus/type/
           * attach/voice/busy) springs it open to the full input. The input
           * surface unmounts when collapsed — the draft is empty by definition
           * there, so nothing is lost. While listening the input stays mounted
           * (it holds the transcript-bound draft) but blurs out of flow so the
           * capsule can spring down to the listening row. */}
          <AnimatePresence initial={false} mode="popLayout">
            {expanded ? (
              <motion.div
                key="input"
                initial={CAPSULE_CONTENT_HIDDEN}
                animate={voiceActive ? CAPSULE_CONTENT_HIDDEN : CAPSULE_CONTENT_VISIBLE}
                exit={CAPSULE_CONTENT_HIDDEN}
                transition={voiceActive ? { duration: 0.15 } : contentSpring}
                inert={voiceActive}
                className={cn(voiceActive && "pointer-events-none absolute inset-x-0 top-0")}
              >
                <PromptInput
                  accept={ACCEPTED_IMAGE_MIME}
                  multiple
                  maxFiles={MAX_ATTACHMENT_COUNT}
                  maxFileSize={MAX_ATTACHMENT_BYTES}
                  onError={onAttachError}
                  onFilesChange={handleFilesChange}
                  onSubmit={handleSubmit}
                  className="bg-transparent [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-3xl [&_[data-slot=input-group]]:border-transparent [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:px-0 [&_[data-slot=input-group]]:py-0 [&_[data-slot=input-group]]:shadow-none"
                >
                  <ComposerAttachments />
                  {/* Two-row layout (the InputGroup block-end pattern): the textarea owns
                   * the top row full-width, a toolbar sits beneath with attach + mic
                   * pinned left and steer/send pinned right — so the controls stay
                   * aligned regardless of how tall the textarea grows. */}
                  <ComposerTextarea
                    busy={busy}
                    onInterrupt={interrupt}
                    onHasInputChange={setHasInput}
                    onEngage={engage}
                  />
                  <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5">
                    <div className="flex items-center gap-1">
                      <AttachButton />
                      <MicButton onStart={() => void voice.start()} />
                    </div>
                    <div className="flex items-center gap-1">
                      <SteerButton busy={busy} hasInput={hasInput} onSteer={requestSteer} />
                      <SubmitOrStop busy={busy} hasInput={hasInput} onInterrupt={interrupt} />
                    </div>
                  </div>
                </PromptInput>
              </motion.div>
            ) : (
              <motion.div
                key="pill"
                initial={CAPSULE_CONTENT_HIDDEN}
                animate={CAPSULE_CONTENT_VISIBLE}
                exit={CAPSULE_CONTENT_HIDDEN}
                transition={contentSpring}
              >
                <CollapsedPill onExpand={engage} onStartVoice={() => void voice.start()} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The listening surface: cancel | orb + live transcript (or a timer until
 * words arrive) | confirm. Height-locked to one row so the capsule reads as
 * the input collapsing into a voice pill. */
function ListeningRow({
  transcript,
  stopping,
  onCancel,
  onConfirm,
}: {
  transcript: string;
  stopping: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // mm:ss readout until the first words arrive. Owned here (not the composer)
  // so the 1 Hz tick re-renders only this row — and stops entirely once a
  // transcript is showing (the readout is hidden then anyway). Mount-scoped
  // per session: AnimatePresence remounts the row for each listening session.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (transcript) return;
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [transcript]);

  return (
    <div className="flex h-14 items-center gap-2 px-2">
      <button
        type="button"
        aria-label="Cancel voice input"
        onClick={onCancel}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
      {/* The orb is the focal voice animation; the live transcript (or a mm:ss
       * timer until words arrive) rides beside it, truncated so the tail stays
       * readable. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
        <ListeningOrb />
        {transcript ? (
          <span className="max-w-[55%] truncate text-xs text-muted-foreground">{transcript}</span>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Confirm voice input"
        onClick={onConfirm}
        disabled={stopping}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
      >
        <CheckIcon className="size-4" />
      </button>
    </div>
  );
}

function AttachButton() {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton
      tooltip="Attach image"
      aria-label="Attach image"
      onClick={openFileDialog}
      className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  );
}

function MicButton({ onStart }: { onStart: () => void }) {
  return (
    <PromptInputButton
      tooltip="Voice input"
      aria-label="Start voice input"
      onClick={onStart}
      className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <MicIcon className="size-4" />
    </PromptInputButton>
  );
}

function ComposerTextarea({
  busy,
  onInterrupt,
  onHasInputChange,
  onEngage,
}: {
  busy: boolean;
  onInterrupt: () => void;
  onHasInputChange: (has: boolean) => void;
  onEngage: () => void;
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
      onFocus={onEngage}
    />
  );
}

/** The resting pill — a compact capsule that springs open to the full input on
 * click (or when the mic starts a voice session). Kept narrow (`whitespace-
 * nowrap` + a short prompt) so the capsule's `w-fit` reads as a small pill. */
function CollapsedPill({
  onExpand,
  onStartVoice,
}: {
  onExpand: () => void;
  onStartVoice: () => void;
}) {
  return (
    <div className="flex h-12 items-center gap-1 pr-1.5 pl-3">
      <button
        type="button"
        onClick={onExpand}
        className="flex h-full flex-1 items-center gap-2 text-left"
      >
        <SparklesIcon className="size-4 shrink-0 text-muted-foreground/70" />
        <span className="text-sm whitespace-nowrap text-muted-foreground">Ask the agent…</span>
      </button>
      <button
        type="button"
        aria-label="Start voice input"
        onClick={onStartVoice}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MicIcon className="size-4" />
      </button>
    </div>
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
      aria-label="Send now (steer the agent)"
      onClick={(e) => {
        onSteer();
        e.currentTarget.form?.requestSubmit();
      }}
      className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
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
        aria-label="Stop"
        onClick={onInterrupt}
        className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <SquareIcon className="size-4" />
      </PromptInputButton>
    );
  }
  return (
    <PromptInputSubmit
      disabled={!hasContent}
      aria-label={busy ? "Queue for next turn" : "Send"}
      className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
    >
      {busy ? <ListPlusIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
    </PromptInputSubmit>
  );
}

function ComposerAttachments() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;
  return (
    <AttachmentGroup className="ml-auto w-fit gap-2 px-2 pt-2 pb-1">
      {files.map((file) => (
        <Attachment
          key={file.id}
          size="xs"
          orientation="vertical"
          className="size-9 rounded-lg border-border"
        >
          <AttachmentMedia variant="image" className="size-full rounded-lg">
            {file.type === "file" && file.url ? (
              <img alt={file.filename || "Image"} src={file.url} />
            ) : (
              <ImageIcon className="size-4 text-muted-foreground" />
            )}
          </AttachmentMedia>
          <AttachmentActions className="top-0 right-0 gap-0">
            <AttachmentAction
              aria-label="Remove"
              onClick={() => remove(file.id)}
              className="size-4 rounded-none rounded-bl bg-foreground/60 text-background opacity-0 group-hover/attachment:opacity-100 hover:bg-foreground/80 hover:text-background [&>svg]:size-2.5"
            >
              <XIcon />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}
