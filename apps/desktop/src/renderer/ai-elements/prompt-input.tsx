"use client";

import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  ReactNode,
} from "react";
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatStatus, FileUIPart } from "ai";
import { CornerDownLeftIcon, SquareIcon, XIcon } from "lucide-react";
import { nanoid } from "nanoid";

import {
  InputGroup,
  InputGroupButton,
  InputGroupTextarea,
} from "@renderer/ai-elements/input-group";
import { Spinner } from "@repo/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener("loadend", () => {
        resolve(typeof reader.result === "string" ? reader.result : null);
      });
      reader.addEventListener("error", () => resolve(null), { once: true });
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const filePartWithoutId = ({ id, ...item }: FileUIPart & { id: string }): FileUIPart => {
  void id;
  return item;
};

export interface AttachmentsContext {
  files: (FileUIPart & { id: string })[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  /** Returns true if the given file would pass the parent's `accept` filter. */
  matchesAccept: (file: File) => boolean;
}

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  const ctx = useContext(LocalAttachmentsContext);
  if (!ctx) {
    throw new Error("usePromptInputAttachments must be used within a PromptInput");
  }
  return ctx;
};

export interface PromptInputMessage {
  text: string;
  files: FileUIPart[];
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "onError"> & {
  accept?: string;
  multiple?: boolean;
  globalDrop?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (err: { code: "max_files" | "max_file_size" | "accept"; message: string }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  // Guards against re-entrant submits. form.reset() runs synchronously but
  // hasInput state in consumer components doesn't update until React flushes,
  // and the file conversion below is async — so without this a rapid second
  // Enter can fire onSubmit twice with the same payload.
  const submittingRef = useRef(false);

  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
  const filesRef = useRef(items);
  // Live count for capacity accounting. Mutated synchronously in add/remove so
  // multiple add() calls within a single React batch (e.g., paste + drop) see
  // each other's contributions and don't both think they have full capacity.
  const liveCountRef = useRef(0);

  useEffect(() => {
    filesRef.current = items;
    liveCountRef.current = items.length;
  }, [items]);

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") return true;
      const patterns = accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const filename = f.name.toLowerCase();
      const mime = f.type.toLowerCase();
      return patterns.some((rawPattern) => {
        const pattern = rawPattern.toLowerCase();
        // ".png" / ".jpg" — extension match against filename
        if (pattern.startsWith(".")) {
          return filename.endsWith(pattern);
        }
        // "image/*" — MIME prefix
        if (pattern.endsWith("/*")) {
          return mime.startsWith(pattern.slice(0, -1));
        }
        // "image/png" — exact MIME
        return mime === pattern;
      });
    },
    [accept],
  );

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = [...fileList];
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({ code: "accept", message: "No files match the accepted types." });
        return;
      }
      const withinSize = (f: File) => (maxFileSize ? f.size <= maxFileSize : true);
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({ code: "max_file_size", message: "All files exceed the maximum size." });
        return;
      }

      // Compute capacity from a synchronous ref (not items.length) so back-to-back
      // add() calls within the same React batch account for each other's pending
      // additions. Side-effecty work (onError, nanoid, blob URLs) stays outside
      // the setState updater so Strict Mode double-invocation doesn't fire
      // onError twice or leak object URLs.
      const capacity =
        typeof maxFiles === "number" ? Math.max(0, maxFiles - liveCountRef.current) : undefined;
      const capped = typeof capacity === "number" ? sized.slice(0, capacity) : sized;
      if (typeof capacity === "number" && sized.length > capacity) {
        onError?.({ code: "max_files", message: "Too many files. Some were not added." });
      }
      if (capped.length === 0) return;
      const newItems: (FileUIPart & { id: string })[] = capped.map((file) => ({
        filename: file.name,
        id: nanoid(),
        mediaType: file.type,
        type: "file",
        url: URL.createObjectURL(file),
      }));
      liveCountRef.current += newItems.length;
      setItems((prev) => [...prev, ...newItems]);
    },
    [matchesAccept, maxFiles, maxFileSize, onError],
  );

  const remove = useCallback((id: string) => {
    // Revoke + count adjust outside the updater so it stays pure (consistent
    // with `add`). filesRef is kept in sync via the useEffect above.
    const target = filesRef.current.find((file) => file.id === id);
    if (target?.url) URL.revokeObjectURL(target.url);
    liveCountRef.current = Math.max(0, liveCountRef.current - 1);
    setItems((prev) => prev.filter((file) => file.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const file of filesRef.current) {
      if (file.url) URL.revokeObjectURL(file.url);
    }
    liveCountRef.current = 0;
    setItems(() => []);
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!form || globalDrop) return;

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(() => {
    if (!globalDrop) return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(
    () => () => {
      for (const f of filesRef.current) {
        if (f.url) URL.revokeObjectURL(f.url);
      }
    },
    [],
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) add(event.currentTarget.files);
      event.currentTarget.value = "";
    },
    [add],
  );

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({ add, clear, files: items, matchesAccept, openFileDialog, remove }),
    [items, add, remove, clear, openFileDialog, matchesAccept],
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      if (submittingRef.current) return;
      submittingRef.current = true;
      const form = event.currentTarget;
      const formData = new FormData(form);
      const message = formData.get("message");
      const text = typeof message === "string" ? message : "";
      form.reset();

      // Snapshot the IDs we're about to submit. Anything the user adds to
      // the tray during the async gap below must survive the post-submit
      // cleanup; only items in this set get revoked + removed.
      const submittedItems = items;
      const submittedIds = new Set(submittedItems.map((item) => item.id));
      const cleanupSubmitted = () => {
        for (const item of submittedItems) {
          if (item.url) URL.revokeObjectURL(item.url);
        }
        liveCountRef.current = Math.max(0, liveCountRef.current - submittedIds.size);
        setItems((prev) => prev.filter((file) => !submittedIds.has(file.id)));
      };

      try {
        const convertedFiles: FileUIPart[] = [];
        for (const submittedItem of submittedItems) {
          const item = filePartWithoutId(submittedItem);
          if (item.url?.startsWith("blob:")) {
            const dataUrl = await convertBlobUrlToDataUrl(item.url);
            convertedFiles.push(Object.assign({}, item, { url: dataUrl ?? item.url }));
            continue;
          }
          convertedFiles.push(item);
        }

        const result = onSubmit({ files: convertedFiles, text }, event);
        if (result instanceof Promise) {
          try {
            await result;
            cleanupSubmitted();
          } catch {
            // Don't clear on error - user may want to retry
          }
        } else {
          cleanupSubmitted();
        }
      } catch {
        // Don't clear on error - user may want to retry
      } finally {
        submittingRef.current = false;
      }
    },
    [items, onSubmit],
  );

  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx}>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form className={cn("w-full", className)} onSubmit={handleSubmit} ref={formRef} {...props}>
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </LocalAttachmentsContext.Provider>
  );
};

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>;

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps) => {
  const attachments = usePromptInputAttachments();
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;

      if (e.key === "Enter") {
        if (isComposing || e.nativeEvent.isComposing) return;
        if (e.shiftKey) return;
        e.preventDefault();
        const { form } = e.currentTarget;
        const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
        // Skip if no submit button is in the DOM (e.g., parent renders a
        // type="button" stop control instead while the agent is busy) or
        // if it exists but is disabled.
        if (!submitButton || submitButton.disabled) return;
        form?.requestSubmit();
      }

      if (e.key === "Backspace" && e.currentTarget.value === "" && attachments.files.length > 0) {
        e.preventDefault();
        const lastAttachment = attachments.files.at(-1);
        if (lastAttachment) attachments.remove(lastAttachment.id);
      }
    },
    [onKeyDown, isComposing, attachments],
  );

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      // Only collect files the parent's `accept` filter would take. Otherwise
      // we'd preventDefault on a paste that has both text and a non-matching
      // file (e.g. a PDF copied from a file manager) and silently swallow
      // both — text wouldn't paste and the file wouldn't attach.
      const files: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && attachments.matchesAccept(file)) files.push(file);
      }
      if (files.length > 0) {
        event.preventDefault();
        attachments.add(files);
      }
    },
    [attachments],
  );

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
    />
  );
};

type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode;
      shortcut?: string;
      side?: ComponentProps<typeof TooltipContent>["side"];
    };

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  tooltip,
  children,
  ...props
}: PromptInputButtonProps) => {
  const newSize = size ?? (Children.count(children) > 1 ? "sm" : "icon-sm");

  const button = (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </InputGroupButton>
  );

  if (!tooltip) return button;

  const tooltipContent = typeof tooltip === "string" ? tooltip : tooltip.content;
  const shortcut = typeof tooltip === "string" ? undefined : tooltip.shortcut;
  const side = typeof tooltip === "string" ? "top" : (tooltip.side ?? "top");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent side={side}>
          {tooltipContent}
          {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "primary",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === "submitted" || status === "streaming";

  let Icon: ReactNode = <CornerDownLeftIcon className="size-4" />;
  if (status === "submitted") Icon = <Spinner />;
  else if (status === "streaming") Icon = <SquareIcon className="size-4" />;
  else if (status === "error") Icon = <XIcon className="size-4" />;

  const handleClick: NonNullable<ComponentProps<typeof InputGroupButton>["onClick"]> = useCallback(
    (e) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick],
  );

  return (
    <InputGroupButton
      aria-label={isGenerating ? "Stop" : "Submit"}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? "button" : "submit"}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  );
};
