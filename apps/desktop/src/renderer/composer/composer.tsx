import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ListPlusIcon,
  MicIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";

import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@renderer/ai-elements/attachments";
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

import { toErrorMessage } from "@repo/features/ipc";
import type { ImageAttachment } from "@repo/features/voice";
import {
  CAPSULE_RADIUS,
  CAPSULE_SPRING,
  CAPSULE_SURFACE,
  ListeningGlow,
  ListeningWave,
} from "@renderer/composer/capsule-motion";
import { useAgentStore } from "@renderer/stores/agent-store";
import { startSTT, type STTHandle } from "@renderer/voice/stt";

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

// ---------------------------------------------------------------------------
// Voice capture — the composer's listening surface over the renderer STT
// pipeline (startSTT owns getUserMedia + the worklet + the IPC session).
// ---------------------------------------------------------------------------

/** The composer's voice-capture lifecycle. `starting` shows the listening
 * surface immediately (mic permission + recognizer spin-up can take a beat);
 * `stopping` covers the await on the recognizer's tail transcript. */
type VoicePhase = "idle" | "starting" | "listening" | "stopping";

/** Join transcript segments with a single space, tolerating empty sides. */
function joinTranscript(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The AI composer — a spring-morphing capsule pinned at the bottom of the
 * workspace. Talks to the agent via agent-store (routing user/follow-up/steer
 * by live busy state) and auto-attaches the open note as context. Tapping the
 * mic morphs the capsule into a listening surface driven by local STT; the
 * confirmed transcript lands in the draft for review, never auto-sent.
 */
export function Composer() {
  const [hasInput, setHasInput] = useState(false);
  const pendingSteerRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion() === true;

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

  // --- Voice capture state -------------------------------------------------

  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const sttHandleRef = useRef<STTHandle | null>(null);
  // Session counter: bumping it orphans in-flight callbacks (tail transcripts
  // after cancel, a startSTT that resolves after the user backed out) so they
  // can't mutate the next session's state.
  const sttSessionRef = useRef(0);
  // Finalized utterances joined so far + the live partial replacing itself.
  const committedRef = useRef("");
  const partialRef = useRef("");
  const voiceActive = voicePhase !== "idle";

  const startListening = useCallback(async () => {
    if (voicePhase !== "idle") return;
    const session = ++sttSessionRef.current;
    committedRef.current = "";
    partialRef.current = "";
    setTranscript("");
    setVoicePhase("starting");
    try {
      const handle = await startSTT(
        (text, isFinal) => {
          if (sttSessionRef.current !== session) return;
          if (isFinal) {
            committedRef.current = joinTranscript(committedRef.current, text);
            partialRef.current = "";
          } else {
            partialRef.current = text;
          }
          setTranscript(joinTranscript(committedRef.current, partialRef.current));
        },
        (error) => {
          if (sttSessionRef.current !== session) return;
          toast.error(`Voice input error: ${error}`);
        },
      );
      if (sttSessionRef.current !== session) {
        // The user backed out while the mic was still spinning up.
        void handle.stop();
        return;
      }
      sttHandleRef.current = handle;
      setVoicePhase("listening");
    } catch (err) {
      if (sttSessionRef.current !== session) return;
      setVoicePhase("idle");
      toast.error(`Voice input unavailable: ${toErrorMessage(err)}`);
    }
  }, [voicePhase]);

  /** Leave the listening surface. On confirm the recognizer stops and the
   * final transcript is appended to the draft for review — never auto-sent.
   * On cancel the session is orphaned first so tail transcripts are dropped. */
  const finishListening = useCallback(
    async (commit: boolean) => {
      const session = sttSessionRef.current;
      const handle = sttHandleRef.current;
      sttHandleRef.current = null;
      if (!commit) {
        sttSessionRef.current++;
        setVoicePhase("idle");
        if (handle) void handle.stop();
        return;
      }
      if (handle) {
        // stop() forwards the recognizer's tail transcript through
        // onTranscript before resolving — await it so the trailing words
        // make it into the draft.
        setVoicePhase("stopping");
        await handle.stop();
      }
      if (sttSessionRef.current !== session) return; // cancelled while stopping
      sttSessionRef.current++;
      setVoicePhase("idle");
      const text = joinTranscript(committedRef.current, partialRef.current).trim();
      if (!text) return;
      const ta = findTextarea();
      if (!ta) return;
      const existing = ta.value.replace(/\s+$/, "");
      const next = existing ? `${existing} ${text}` : text;
      ta.value = next;
      ta.setSelectionRange(next.length, next.length);
      setHasInput(next.trim().length > 0);
    },
    [findTextarea],
  );

  // Returning from the listening surface hands focus back to the textarea so
  // the transcript is immediately reviewable/editable.
  const wasVoiceRef = useRef(false);
  useEffect(() => {
    if (voiceActive) {
      wasVoiceRef.current = true;
      return;
    }
    if (!wasVoiceRef.current) return;
    wasVoiceRef.current = false;
    findTextarea()?.focus();
  }, [voiceActive, findTextarea]);

  // mm:ss fallback readout while no transcript has arrived yet.
  useEffect(() => {
    if (!voiceActive) return;
    setElapsed(0);
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [voiceActive]);

  // Escape cancels listening (the textarea's own Escape handler is inert
  // while the input surface is hidden).
  useEffect(() => {
    if (!voiceActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      void finishListening(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voiceActive, finishListening]);

  // Unmount: orphan the session and drop the mic.
  useEffect(
    () => () => {
      sttSessionRef.current++;
      const handle = sttHandleRef.current;
      sttHandleRef.current = null;
      if (handle) void handle.stop();
    },
    [],
  );

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

  // One spring for the capsule shape; content crossfades a beat later so the
  // shape reads first, details second.
  const capsuleSpring: Transition = reduceMotion ? { duration: 0 } : CAPSULE_SPRING;
  const contentSpring: Transition = reduceMotion
    ? { duration: 0 }
    : { ...CAPSULE_SPRING, delay: 0.05 };

  return (
    <div ref={wrapperRef} className="flex flex-col gap-1.5">
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
          className={CAPSULE_SURFACE}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {voiceActive && (
              <motion.div
                key="listening"
                initial={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
                transition={contentSpring}
              >
                <ListeningRow
                  transcript={transcript}
                  elapsed={elapsed}
                  stopping={voicePhase === "stopping"}
                  onCancel={() => void finishListening(false)}
                  onConfirm={() => void finishListening(true)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* The input surface stays MOUNTED while listening (attachments and
           * the draft live in it) — it fades out and drops out of flow so the
           * capsule can spring down to the listening row's height. */}
          <motion.div
            animate={
              voiceActive
                ? { opacity: 0, scale: 0.96, filter: "blur(6px)" }
                : { opacity: 1, scale: 1, filter: "blur(0px)" }
            }
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
              />
              <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5">
                <div className="flex items-center gap-1">
                  <AttachButton />
                  <MicButton onStart={() => void startListening()} />
                </div>
                <div className="flex items-center gap-1">
                  <SteerButton busy={busy} hasInput={hasInput} onSteer={requestSteer} />
                  <SubmitOrStop busy={busy} hasInput={hasInput} onInterrupt={interrupt} />
                </div>
              </div>
            </PromptInput>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

/** The listening surface: cancel | wave | live transcript (or a timer until
 * words arrive) | confirm. Height-locked to one row so the capsule reads as
 * the input collapsing into a voice pill. */
function ListeningRow({
  transcript,
  elapsed,
  stopping,
  onCancel,
  onConfirm,
}: {
  transcript: string;
  elapsed: number;
  stopping: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex h-12 items-center gap-2 px-2">
      <button
        type="button"
        aria-label="Cancel voice input"
        onClick={onCancel}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
      <ListeningWave />
      {transcript ? (
        // Right-aligned in an overflow-hidden box so the TAIL of the live
        // transcript stays visible as it grows.
        <div className="flex max-w-[45%] justify-end overflow-hidden">
          <span className="text-xs whitespace-nowrap text-muted-foreground">{transcript}</span>
        </div>
      ) : (
        <span className="w-10 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {formatElapsed(elapsed)}
        </span>
      )}
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
    <Attachments className="px-2 pt-2 pb-1">
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
