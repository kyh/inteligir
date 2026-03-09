"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";

import { cn } from "@/lib/utils";
import { Editor, EditorContainer } from "@/registry/ui/editor";
import { TocSidebar } from "@/registry/ui/toc-sidebar";
import { Skeleton } from "@repo/ui/skeleton";
import { useDocumentQueryOptions } from "@/trpc/hooks/query-options";

export const TEXT_STYLE_ITEMS = [
  { key: "default", label: "Default", fontFamily: "inherit" },
  { key: "serif", label: "Serif", fontFamily: "Georgia, serif" },
  { key: "mono", label: "Mono", fontFamily: "ui-monospace, monospace" },
];

export const PlateEditor = ({ mode }: { mode?: "print" }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  const queryOptions = useDocumentQueryOptions();

  const { data: toc, isLoading } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.toc ?? true,
  });
  const { data: fullWidth } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.fullWidth,
  });
  const { data: smallText } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.smallText,
  });
  const { data: textStyle } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.textStyle,
  });

  const fontFamily = useMemo(
    () => ({
      fontFamily: TEXT_STYLE_ITEMS.find((item) => item.key === textStyle)?.fontFamily,
    }),
    [textStyle],
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
      {toc && mode !== "print" && <TocSidebar className="top-[130px]" topOffset={30} />}

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
