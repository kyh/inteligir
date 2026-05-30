"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@repo/ui/lib/utils";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { springs } from "@repo/ui/lib/springs";
import { getShape } from "@repo/ui/lib/shape";
import { getIcon } from "@repo/ui/lib/icon";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider } from "@repo/ui/lib/surface-context";
import { Button } from "@repo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/components/tooltip";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const DEFAULT_ACCEPT = "image/png,image/jpeg,application/pdf";

interface InputMessageSlotContext {
  /** Opens the native file picker via the hidden `<input type="file">`.
   *  Pass `acceptOverride` (e.g. `"image/*"`) to scope the picker to a
   *  subset of the component's accept types just for this invocation. */
  openFilePicker: (acceptOverride?: string) => void;
  /** Currently-attached files (controlled). */
  files: File[];
}

type InputMessageSlot = ReactNode | ((ctx: InputMessageSlotContext) => ReactNode);

interface InputMessageProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Controlled textarea value. */
  value: string;
  /** Called with the new value on every textarea change. */
  onValueChange: (value: string) => void;
  /** Fired when the user submits (Enter or send button). Receives the trimmed
   *  value plus the currently-attached files. */
  onSend?: (value: string, files: File[]) => void;
  /** Placeholder text shown when the value is empty. */
  placeholder?: string;
  /** Content rendered in the bottom-left action area. Can be a function that
   *  receives `{ openFilePicker, files }` to wire an attach button. */
  leftSlot?: InputMessageSlot;
  /** Content rendered in the bottom-right action area, before the built-in
   *  send button. Same render-fn shape as leftSlot. */
  rightSlot?: InputMessageSlot;
  /** Disables the textarea, send button, and drag-and-drop. */
  disabled?: boolean;
  /** Minimum visible rows before the textarea grows. */
  minRows?: number;
  /** Maximum visible rows before the textarea starts to scroll. */
  maxRows?: number;
  /** When false, clicking the surrounding container won't refocus the textarea. */
  clickToFocus?: boolean;
  /** Accessible label for the send button. */
  sendLabel?: string;
  /** Controlled list of attached files. When undefined, attachment behavior
   *  is disabled (no drag-drop, no file input). */
  files?: File[];
  /** Called when files are added (drag-drop or picker) or removed. */
  onFilesChange?: (files: File[]) => void;
  /** Accepted MIME types as a comma-separated string. Defaults to PNG / JPEG / PDF. */
  accept?: string;
  /** Maximum number of files. Extra files are dropped when the limit is exceeded. */
  maxFiles?: number;
  /** Side of each preview tile in pixels. Defaults to 80. */
  filePreviewSize?: number;
  /** Extra props forwarded to the underlying textarea. */
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange" | "onKeyDown" | "disabled" | "placeholder"
  >;
}

// ─── Lazy pdfjs loader ────────────────────────────────────────────────────
// Imports pdfjs-dist on first PDF, caches the module, and points the worker
// at the matching CDN build. Consumers don't need bundler-side worker config.
type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      if (!mod.GlobalWorkerOptions.workerSrc) {
        mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${mod.version}/build/pdf.worker.min.mjs`;
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

async function renderPdfFirstPage(file: File, targetWidth: number): Promise<string> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = (targetWidth * 2) / baseViewport.width; // 2× for retina
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL("image/png");
}

// ─── File preview tile ────────────────────────────────────────────────────
// Square thumbnail with a hover-revealed remove (×) button. Images use
// object-cover via `URL.createObjectURL`; PDFs render the first page via
// pdfjs; other types fall back to a centered file icon.
interface FilePreviewTileProps {
  file: File;
  onRemove: () => void;
  size: number;
}

function FilePreviewTile({ file, onRemove, size }: FilePreviewTileProps) {
  const XIcon = getIcon("x");
  const shape = getShape();
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";

  // Create blob URL inside an effect (NOT useMemo) so the cleanup-revoke
  // and the URL-creation stay in sync. In React 18 StrictMode dev, a
  // useMemo-created URL gets revoked by the simulated effect-cleanup but
  // useMemo doesn't re-run on the simulated re-mount (no re-render happens),
  // leaving the DOM with a stale, revoked `blob:` URL — broken image.
  // Putting both in the same effect means the simulated re-mount creates a
  // fresh URL and updates state. The one-frame "before URL" state is
  // covered by the bg-accent (no fallback icon shown for images), so the
  // transition is visually clean.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isImage, file]);

  // PDFs need async rendering — loading flash is unavoidable for the first
  // ~100–300ms while pdfjs loads. Falls back to the generic icon on error.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    renderPdfFirstPage(file, size)
      .then((url) => {
        if (!cancelled) setPdfUrl(url);
        return undefined;
      })
      .catch(() => {
        /* fall through to icon */
      });
    return () => {
      cancelled = true;
    };
  }, [file, isPdf, size]);

  const previewUrl = imageUrl ?? pdfUrl;

  return (
    <motion.div
      // `layout` animates sibling tiles into the gap when one is removed.
      // Enter: spring-fast (0.08s) — the chip category per animation-guidelines.md.
      // Exit: 0.06s linear — "exits should be slightly faster than enter",
      // matches CheckboxGroup's hover-bg pattern.
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.06 } }}
      transition={springs.fast}
      className={cn(
        // `cursor-default` opts out of the parent's `cursor-text` so hovering
        // a preview tile doesn't look like it'll land in the textarea.
        "relative shrink-0 overflow-hidden bg-accent border border-border cursor-default group/tile",
        shape.bg,
      )}
      style={{ width: size, height: size }}
    >
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={file.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        // Circular spinner while we wait for the preview to be ready.
        // Used for both images (brief URL-creation gap) and PDFs (longer
        // pdfjs render). The thin ring is mostly subtle (border-border)
        // with one quadrant accented (border-t-muted-foreground) so the
        // `animate-spin` rotation reads as a moving arc.
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-6 h-6 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
            aria-label="Loading preview"
            role="status"
          />
        </div>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label={`Remove ${file.name}`}
              // Force the light-mode palette (dark circle + white X) regardless
              // of theme — the close badge needs to read as a "delete affordance"
              // over arbitrary image/PDF content, so it sits at a fixed contrast
              // instead of flipping with the surrounding surface.
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-neutral-900 text-white opacity-0 group-hover/tile:opacity-100 transition-opacity duration-80 flex items-center justify-center cursor-pointer outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[#6B97FF]"
            >
              <XIcon size={12} strokeWidth={2.5} />
            </button>
          }
        />
        <TooltipContent side="top">Remove</TooltipContent>
      </Tooltip>
    </motion.div>
  );
}

// ─── InputMessage ─────────────────────────────────────────────────────────

const InputMessage = forwardRef<HTMLDivElement, InputMessageProps>(
  (
    {
      value,
      onValueChange,
      onSend,
      placeholder = "Ask me anything…",
      leftSlot,
      rightSlot,
      disabled,
      minRows = 1,
      maxRows = 8,
      clickToFocus = true,
      sendLabel = "Send",
      files,
      onFilesChange,
      accept = DEFAULT_ACCEPT,
      maxFiles,
      filePreviewSize = 80,
      textareaProps,
      className,
      ...props
    },
    ref,
  ) => {
    const shape = getShape();
    const ArrowUpIcon = getIcon("arrow-up");

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [focusVisible, setFocusVisible] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    const filesArr = useMemo(() => files ?? [], [files]);
    const supportsFiles = onFilesChange !== undefined;

    useIsoLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      const computed = getComputedStyle(el);
      const lineHeight = parseFloat(computed.lineHeight);
      if (Number.isNaN(lineHeight)) return;
      const min = lineHeight * minRows;
      const max = lineHeight * maxRows;
      const next = Math.min(Math.max(el.scrollHeight, min), max);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    }, [value, minRows, maxRows]);

    const trimmed = value.trim();
    const canSend = !disabled && (trimmed.length > 0 || filesArr.length > 0);

    const handleSend = useCallback(() => {
      if (!canSend) return;
      onSend?.(trimmed, filesArr);
    }, [canSend, onSend, trimmed, filesArr]);

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      [handleSend],
    );

    const handleContainerMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!clickToFocus || disabled) return;
        const target = e.target as HTMLElement;
        if (target === textareaRef.current) return;
        if (
          target.closest('button, a, input, select, textarea, [contenteditable], [role="button"]')
        ) {
          return;
        }
        e.preventDefault();
        textareaRef.current?.focus();
      },
      [clickToFocus, disabled],
    );

    // ── File helpers ──────────────────────────────────────────────────
    const acceptTokens = useMemo(
      () =>
        accept
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      [accept],
    );

    const matchesAccept = useCallback(
      (file: File) =>
        acceptTokens.some((token) => {
          if (token.endsWith("/*")) return file.type.startsWith(token.slice(0, -1));
          if (token.startsWith(".")) return file.name.toLowerCase().endsWith(token.toLowerCase());
          return file.type === token;
        }),
      [acceptTokens],
    );

    const addFiles = useCallback(
      (incoming: File[]) => {
        if (!onFilesChange) return;
        // Identity key for dedup: name + size + lastModified is unique enough
        // to catch "user dropped the same file twice" without false positives
        // on legitimately distinct files (different bytes ⇒ different size).
        const fingerprint = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;
        const existing = new Set(filesArr.map(fingerprint));
        const accepted: File[] = [];
        for (const f of incoming) {
          if (!matchesAccept(f)) continue;
          const fp = fingerprint(f);
          if (existing.has(fp)) continue;
          existing.add(fp);
          accepted.push(f);
        }
        if (!accepted.length) return;
        const next = [...filesArr, ...accepted];
        onFilesChange(maxFiles != null ? next.slice(0, maxFiles) : next);
      },
      [onFilesChange, filesArr, matchesAccept, maxFiles],
    );

    const removeFile = useCallback(
      (idx: number) => {
        if (!onFilesChange) return;
        onFilesChange(filesArr.filter((_, i) => i !== idx));
      },
      [onFilesChange, filesArr],
    );

    const openFilePicker = useCallback(
      (overrideAccept?: string) => {
        const el = fileInputRef.current;
        if (!el) return;
        // Temporarily narrow `accept` for this invocation (e.g. "image/*").
        // Reset after the click so subsequent native invocations still honor
        // the component-level accept.
        if (overrideAccept) {
          el.accept = overrideAccept;
          el.click();
          // Restore on next tick — the picker dialog reads `accept` synchronously.
          queueMicrotask(() => {
            if (fileInputRef.current) fileInputRef.current.accept = accept;
          });
          return;
        }
        el.click();
      },
      [accept],
    );

    // ── Slot rendering ────────────────────────────────────────────────
    const slotCtx = useMemo<InputMessageSlotContext>(
      () => ({ openFilePicker, files: filesArr }),
      [openFilePicker, filesArr],
    );
    const leftContent = typeof leftSlot === "function" ? leftSlot(slotCtx) : leftSlot;
    const rightContent = typeof rightSlot === "function" ? rightSlot(slotCtx) : rightSlot;

    // ── Drag-and-drop ────────────────────────────────────────────────
    const handleDragOver = useCallback(
      (e: ReactDragEvent<HTMLDivElement>) => {
        if (!supportsFiles || disabled) return;
        // Only treat as a file drag — text/HTML drags shouldn't trigger.
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      },
      [supportsFiles, disabled],
    );

    const handleDragLeave = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
      const wrapper = e.currentTarget;
      const next = e.relatedTarget as Node | null;
      if (next && wrapper.contains(next)) return;
      setDragOver(false);
    }, []);

    const handleDrop = useCallback(
      (e: ReactDragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        if (!supportsFiles || disabled) return;
        addFiles(Array.from(e.dataTransfer.files));
      },
      [supportsFiles, disabled, addFiles],
    );

    const handleFileInputChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        addFiles(Array.from(e.target.files));
        e.target.value = ""; // Allow re-selecting the same file.
      },
      [addFiles],
    );

    return (
      <div
        ref={ref}
        onMouseDown={handleContainerMouseDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          // Edge comes from surface-2 + shadow-surface-2; the border is a
          // transparent placeholder so swapping in the hover / focus / drag-
          // over colour doesn't shift layout. Hover and focus both use the
          // neutral border token (just bumped contrast) — no blue ring —
          // so the composer stays quiet inside chat layouts.
          "flex flex-col gap-1 p-2 border border-transparent transition-colors duration-80",
          surfaceClasses(2, 2),
          shape.container,
          clickToFocus && !disabled && "cursor-text",
          // Edge state precedence (highest → lowest):
          //   1. drag-over → blue focus-ring colour (drop affordance)
          //   2. focus     → neutral border bump
          //   3. hover     → subtle neutral border
          // Only one rule is attached at a time so Tailwind's `:hover`
          // cascade can't beat the JS-applied focus / drag colours.
          dragOver && "border-[#6B97FF]",
          !dragOver && focusVisible && "border-foreground/20",
          !dragOver && !focusVisible && clickToFocus && !disabled && "hover:border-border",
          disabled && "opacity-50 pointer-events-none",
          className,
        )}
        {...props}
      >
        <SurfaceProvider value={2}>
          {supportsFiles && (
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple={maxFiles == null || maxFiles > 1}
              className="hidden"
              onChange={handleFileInputChange}
              aria-hidden="true"
              tabIndex={-1}
            />
          )}

          {/* Attached files preview row — sits above the textarea.
              The outer motion.div animates the row's height (collapsing the
              whole component height) when files appear / disappear.
              The inner `mode="popLayout"` AnimatePresence pulls a removing
              tile out of layout flow so siblings can slide into the gap
              without fighting its exit anim. Keys are purely file-identity
              (no index) so removing the first file doesn't re-key — and
              remount — every surviving sibling. */}
          <AnimatePresence initial={false}>
            {filesArr.length > 0 && (
              <motion.div
                key="preview-row"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ ...springs.moderate, bounce: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-2 pb-1">
                  <AnimatePresence initial={false} mode="popLayout">
                    {filesArr.map((file, i) => (
                      <FilePreviewTile
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        file={file}
                        onRemove={() => removeFile(i)}
                        size={filePreviewSize}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              if (e.target.matches(":focus-visible")) setFocusVisible(true);
            }}
            onBlur={() => setFocusVisible(false)}
            placeholder={dragOver && supportsFiles ? "Drop files here to add to chat" : placeholder}
            disabled={disabled}
            rows={minRows}
            aria-label={textareaProps?.["aria-label"] ?? "Message"}
            className={cn(
              "w-full resize-none bg-transparent outline-none",
              "text-[14px] text-foreground placeholder:text-muted-foreground",
              "px-2 py-2",
            )}
            style={{ fontVariationSettings: fontWeights.normal }}
            {...textareaProps}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">{leftContent}</div>
            <div className="flex items-center gap-1.5 shrink-0">
              {rightContent}
              <Button
                type="button"
                variant="default"
                size="icon-sm"
                onClick={handleSend}
                disabled={!canSend}
                aria-label={sendLabel}
              >
                <ArrowUpIcon />
              </Button>
            </div>
          </div>
        </SurfaceProvider>
      </div>
    );
  },
);

InputMessage.displayName = "InputMessage";

export { InputMessage };
export type { InputMessageProps, InputMessageSlotContext };
export default InputMessage;
