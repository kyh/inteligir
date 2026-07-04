"use client";

import type { ComponentProps, HTMLAttributes } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import type { FileUIPart, SourceDocumentUIPart } from "ai";
import { ImageIcon, XIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

type AttachmentData = (FileUIPart & { id: string }) | (SourceDocumentUIPart & { id: string });

interface AttachmentContextValue {
  data: AttachmentData;
  onRemove?: (() => void) | undefined;
}

const AttachmentContext = createContext<AttachmentContextValue | null>(null);

const useAttachmentContext = () => {
  const ctx = useContext(AttachmentContext);
  if (!ctx) {
    throw new Error("Attachment components must be used within <Attachment>");
  }
  return ctx;
};

export const Attachments = ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ml-auto flex w-fit flex-wrap items-start gap-2", className)} {...props}>
    {children}
  </div>
);

export type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData;
  onRemove?: () => void;
};

export const Attachment = ({ data, onRemove, className, children, ...props }: AttachmentProps) => {
  const contextValue = useMemo<AttachmentContextValue>(
    () => ({ data, onRemove }),
    [data, onRemove],
  );

  return (
    <AttachmentContext.Provider value={contextValue}>
      <div
        className={cn("group relative size-24 overflow-hidden rounded-lg", className)}
        {...props}
      >
        {children}
      </div>
    </AttachmentContext.Provider>
  );
};

export const AttachmentPreview = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  const { data } = useAttachmentContext();

  return (
    <div
      className={cn(
        "flex size-full shrink-0 items-center justify-center overflow-hidden bg-muted",
        className,
      )}
      {...props}
    >
      {data.type === "file" && data.url ? (
        <img
          alt={data.filename || "Image"}
          className="size-full object-cover"
          height={96}
          src={data.url}
          width={96}
        />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground" />
      )}
    </div>
  );
};

export type AttachmentRemoveProps = ComponentProps<typeof Button> & {
  label?: string;
};

export const AttachmentRemove = ({
  label = "Remove",
  className,
  children,
  ...props
}: AttachmentRemoveProps) => {
  const { onRemove } = useAttachmentContext();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove?.();
    },
    [onRemove],
  );

  if (!onRemove) return null;

  return (
    <Button
      aria-label={label}
      className={cn(
        "absolute right-2 top-2 size-6 rounded-full p-0",
        "bg-background/80 backdrop-blur-sm",
        "opacity-0 transition-opacity group-hover:opacity-100",
        "hover:bg-background",
        "[&>svg]:size-3",
        className,
      )}
      type="button"
      variant="ghost"
      {...props}
      onClick={handleClick}
    >
      {children ?? <XIcon />}
      <span className="sr-only">{label}</span>
    </Button>
  );
};
