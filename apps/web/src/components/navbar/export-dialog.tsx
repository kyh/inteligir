"use client";

import { MarkdownPlugin } from "@platejs/markdown";
import { useQuery } from "@tanstack/react-query";
import { createSlateEditor } from "platejs";
import { useEditorRef } from "platejs/react";
import { serializeHtml } from "platejs/static";
import * as React from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BaseEditorKit } from "@/registry/components/editor/editor-base-kit";
import { downloadFile } from "@/registry/lib/download-file";
import { Button } from "@/registry/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/registry/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/registry/ui/dropdown-menu";
import { EditorStatic } from "@/registry/ui/editor-static";
import { Label } from "@repo/ui/label";
import { useDocumentQueryOptions } from "@/trpc/hooks/query-options";

import { Icons } from "../ui/icons";
import { TEXT_STYLE_ITEMS } from "./document-menu";

export function ExportDialog() {
  const editor = useEditorRef();

  const [type, setType] = useState("markdown");
  const [isExporting, setIsExporting] = useState(false);

  const queryOptions = useDocumentQueryOptions();

  const { data: title } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.title,
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

  const handleExportHtml = async () => {
    try {
      setIsExporting(true);

      const editorStatic = createSlateEditor({
        plugins: BaseEditorKit,
        value: editor.children,
      });

      const editorHtml = await serializeHtml(editorStatic, {
        editorComponent: EditorStatic,
        props: {
          style: {
            padding: "0 calc(50% - 350px)",
            paddingBottom: "",
            ...fontFamily,
          },
        },
      });

      const tailwindCss = `<link rel="stylesheet" href="${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/css/tailwind.css">`;
      const katexCss = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.18/dist/katex.css" integrity="sha384-9PvLvaiSKCPkFKB1ZsEoTjgnJn+O3KvEwtsz37/XrkYft3DTk2gHdYvd9oWgW3tV" crossorigin="anonymous">`;

      const html = `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="color-scheme" content="light" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;700&display=swap"
            rel="stylesheet"
          />
          <style>
            :root {
              --font-sans: 'Inter', sans-serif;
              --font-mono: 'JetBrains Mono', monospace;
            }
          </style>
          ${tailwindCss}
          ${katexCss}
        </head>
        <body>
          ${editorHtml}
        </body>
      </html>`;

      const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

      void downloadFile(url, `${title || "document"}.html`);
    } catch {
      toast.error("Failed to export HTML");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMarkdown = async () => {
    try {
      setIsExporting(true);
      const md = editor.getApi(MarkdownPlugin).markdown.serialize();
      const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;
      await downloadFile(url, `${title || "document"}.md`);
    } catch {
      toast.error("Failed to export Markdown");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DialogContent className="px-10 md:max-w-[445px]">
      <DialogHeader>
        <DialogTitle>Export</DialogTitle>
        <DialogDescription>Choose your export preferences</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 py-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="format">Export format</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={isExporting}>
              <Button className="ml-auto w-fit justify-between" variant="ghost">
                {type.toUpperCase()}
                <Icons.chevronDown className="ml-2 size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-full min-w-32 py-1">
              <DropdownMenuItem onClick={() => setType("markdown")}>Markdown</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setType("html")}>HTML</DropdownMenuItem>
              <DropdownMenuItem disabled onClick={() => setType("pdf")}>
                PDF
                <DropdownMenuShortcut>soon</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled onClick={() => setType("word")}>
                Word
                <DropdownMenuShortcut>soon</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={isExporting}
          onClick={() => {
            switch (type) {
              case "html": {
                void handleExportHtml();
                break;
              }
              case "markdown": {
                void handleExportMarkdown();
                break;
              }
            }
          }}
          variant="brand"
        >
          {isExporting ? (
            <>
              <Icons.spinner className="mr-2 size-4 animate-spin" />
              Exporting...
            </>
          ) : (
            "Export file"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
