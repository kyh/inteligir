"use client";

import { MarkdownPlugin } from "@platejs/markdown";
import { useEditorRef } from "platejs/react";
import { getEditorDOMFromHtmlString } from "platejs/static";
import * as React from "react";
import { useState } from "react";
import { useFilePicker } from "use-file-picker";

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

import { popModal } from "../modals";
import { Icons } from "../ui/icons";
import { Label } from "../ui/label";

export function ImportDialog() {
  const [type, setType] = useState("html");
  const [accept, setAccept] = useState("text/html");
  const [isLoading, setIsLoading] = useState(false);
  const editor = useEditorRef();

  const getFileNodes = (text: string, fileType: string) => {
    if (fileType === "html") {
      const editorNode = getEditorDOMFromHtmlString(text);

      return editor.api.html.deserialize({
        element: editorNode,
      });
    }
    if (fileType === "markdown") {
      return editor.getApi(MarkdownPlugin).markdown.deserialize(text);
    }

    return [];
  };

  const { openFilePicker } = useFilePicker({
    readFilesContent: false,
    accept,
    multiple: false,
    onFilesSelected: async ({ plainFiles }) => {
      if (!plainFiles) return;

      try {
        setIsLoading(true);
        const text = await plainFiles[0].text();
        const nodes = getFileNodes(text, type);
        editor.tf.insertNodes(nodes);
        popModal("Import");
      } finally {
        setIsLoading(false);
      }
    },
  });

  return (
    <DialogContent className="md:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Import</DialogTitle>
        <DialogDescription>Choose your import preferences</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2 py-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="format">Import format</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="ml-auto w-fit justify-between" variant="ghost">
                {type.toUpperCase()}
                <Icons.chevronDown className="ml-2 size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-full min-w-32 py-1">
              <DropdownMenuItem
                onClick={() => {
                  setType("html");
                  setAccept("text/html");
                }}
              >
                HTML
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setType("markdown");
                  setAccept(".md");
                }}
              >
                Markdown
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                Word
                <DropdownMenuShortcut>soon</DropdownMenuShortcut>
              </DropdownMenuItem>

              <DropdownMenuItem disabled>
                CSV
                <DropdownMenuShortcut>soon</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DialogFooter>
        <Button disabled={isLoading} onClick={openFilePicker} variant="brand">
          {isLoading ? (
            <>
              <Icons.spinner className="mr-2 size-4 animate-spin" />
              Importing...
            </>
          ) : (
            "Choose file"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
