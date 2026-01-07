"use client";

import { AIChatPlugin } from "@platejs/ai/react";
import { usePluginOption } from "platejs/react";
import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { Editor, EditorContainer } from "@/registry/ui/editor";
import { TocSidebar } from "@/registry/ui/toc-sidebar";
import { Skeleton } from "@repo/ui/skeleton";
import { api } from "@/trpc/react";

export const TEXT_STYLE_ITEMS = [
  { key: "default", label: "Default", fontFamily: "inherit" },
  { key: "serif", label: "Serif", fontFamily: "Georgia, serif" },
  { key: "mono", label: "Mono", fontFamily: "ui-monospace, monospace" },
];

export const PlateEditor = ({
  documentId,
  mode,
}: {
  documentId: string;
  mode?: "print";
}) => {
  const contentRef = usePluginOption(AIChatPlugin, "contentRef") as any;

  const { data: document, isLoading } = api.document.document.useQuery(
    { id: documentId },
    { enabled: !!documentId }
  );

  const toc = document?.document?.toc ?? true;
  const fullWidth = document?.document?.fullWidth;
  const smallText = document?.document?.smallText;
  const textStyle = document?.document?.textStyle;

  const fontFamily = useMemo(
    () => ({
      fontFamily: TEXT_STYLE_ITEMS.find((item) => item.key === textStyle)
        ?.fontFamily,
    }),
    [textStyle]
  );

  if (isLoading) {
    return (
      <div>
        <div className="mx-auto mt-10 md:max-w-3xl lg:max-w-4xl">
          <div className="space-y-4 pl-8 pt-4">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex-1" ref={contentRef}>
      {toc && mode !== "print" && (
        <TocSidebar className="top-[130px]" topOffset={30} />
      )}

      <EditorContainer>
        <Editor
          className={cn(smallText && "text-sm")}
          style={fontFamily}
          variant={fullWidth ? "fullWidth" : "default"}
        />
      </EditorContainer>
    </div>
  );
};
