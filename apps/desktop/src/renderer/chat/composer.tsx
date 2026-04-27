import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ImageIcon, SendIcon, SquareIcon, XIcon, ZapIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";

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

// Read a File as base64. Strips the `data:<mime>;base64,` prefix that
// FileReader.readAsDataURL produces — pi-ai's ImageContent.data wants the
// raw base64 payload only.
function readFileAsBase64(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      const commaIdx = result.indexOf(",");
      const data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({ data, mimeType: file.type || "image/png" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

export function Composer() {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  // Object URLs for inline previews — released when the attachment is removed.
  const previewUrls = useRef<Map<number, string>>(new Map());

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const appState = useAgentStore((s) => s.appState);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const followUp = useAgentStore((s) => s.followUp);
  const interrupt = useAgentStore((s) => s.interrupt);
  const queuedFollowUp = useAgentStore((s) => s.queuedFollowUp);
  const queuedSteering = useAgentStore((s) => s.queuedSteering);

  const busy = appState.phase === "ready" && appState.agent === "busy";
  const sessionStatus = getSessionStatus(appState);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Free object URLs on unmount.
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const attachFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    const results = await Promise.all(list.map(readFileAsBase64));
    setImages((prev) => [...prev, ...results]);
  }, []);

  const onPickFiles = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) void attachFiles(files);
      // Allow re-selecting the same file later.
      e.target.value = "";
    },
    [attachFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void attachFiles(files);
      }
    },
    [attachFiles],
  );

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    const url = previewUrls.current.get(index);
    if (url) {
      URL.revokeObjectURL(url);
      previewUrls.current.delete(index);
    }
  }, []);

  // While busy, default to queueing as follow-up (the agent will pick it up
  // after the current turn). The bolt button overrides to steer (interrupt).
  const dispatch = useCallback(
    (mode: "auto" | "steer") => {
      const text = input.trim();
      if (!text && images.length === 0) return;
      const imgs = images.length > 0 ? images : undefined;

      if (busy && mode === "steer") {
        steer(text, imgs);
      } else if (busy) {
        followUp(text, imgs);
      } else {
        sendMessage(text, imgs);
      }
      setInput("");
      setImages([]);
    },
    [input, images, busy, steer, followUp, sendMessage],
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      dispatch("auto");
    },
    [dispatch],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy) {
          interrupt();
        } else if (input.length > 0 || images.length > 0) {
          setInput("");
          setImages([]);
        }
      }
    },
    [busy, input, images.length, interrupt],
  );

  const queueCount = queuedFollowUp.length + queuedSteering.length;

  return (
    <div className="bg-foreground/8 px-3 py-2">
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

      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {images.map((img, i) => (
            <div
              key={i}
              className="relative h-12 w-12 overflow-hidden rounded border border-border"
            >
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt=""
                className="size-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute right-0 top-0 rounded-bl bg-background/80 p-0.5 text-foreground hover:bg-background"
                aria-label="Remove image"
              >
                <XIcon className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            statusColors[sessionStatus],
          )}
        />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={busy ? "Queue message..." : "Message..."}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_MIME}
          multiple
          className="hidden"
          onChange={onPickFiles}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Attach image"
          title="Attach image"
        >
          <ImageIcon className="size-3.5" />
        </button>

        {busy && (input.trim().length > 0 || images.length > 0) && (
          <button
            type="button"
            onClick={() => dispatch("steer")}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Send now (steer)"
            title="Send now (steer the agent)"
          >
            <ZapIcon className="size-3.5" />
          </button>
        )}

        {busy && input.trim().length === 0 && images.length === 0 ? (
          <button
            type="button"
            onClick={interrupt}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Stop"
          >
            <SquareIcon className="size-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Send"
          >
            <SendIcon className="size-3.5" />
          </button>
        )}
      </form>
    </div>
  );
}
