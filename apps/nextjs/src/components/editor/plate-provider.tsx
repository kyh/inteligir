"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { KEYS, NodeIdPlugin, type Value } from "platejs";
import { createPlateEditor, Plate, usePlateEditor } from "platejs/react";
import React, { useMemo } from "react";

import { EditorKit } from "@/components/editor/editor-kit-app";
import { useDebouncedCallback } from "@/hooks/useDebounceCallback";
import { useInitialLocalStorage } from "@/hooks/useLocalStorage";
import { useWarnIfUnsavedChanges } from "@/hooks/useWarnIfUnsavedChanges";
import { BaseEditorKit } from "@/registry/components/editor/editor-base-kit";
import { api } from "@/trpc/react";
import {
  getTemplateDocument,
  type TemplateDocument,
  useTemplateDocument,
} from "./utils/useTemplateDocument";

interface DocumentPlateProps {
  children: React.ReactNode;
  documentId: string;
}

export function DocumentPlate({ children, documentId }: DocumentPlateProps) {
  const queryClient = useQueryClient();

  const { data: document } = api.document.document.useQuery(
    { id: documentId },
    { enabled: !!documentId }
  );

  const updateDocument = api.document.update.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
  });

  const lockPage = document?.document?.lockPage;
  const isArchived = document?.document?.isArchived;
  const templateId = document?.document?.templateId;
  const contentRich = document?.document?.contentRich;

  const value =
    templateId && !contentRich
      ? getTemplateDocument(templateId)?.value
      : (contentRich as Value);

  const editor = usePlateEditor(
    {
      id: documentId,
      plugins: [
        ...EditorKit,
        NodeIdPlugin.configure({
          priority: 50,
        }),
      ],
      value,
    },
    [documentId]
  );

  const debouncedUpdate = useDebouncedCallback(
    (id: string, value: Value) => {
      updateDocument.mutate({ id, contentRich: value });
    },
    1000
  );

  return (
    <Plate
      editor={editor}
      onValueChange={({ editor, value }) => {
        debouncedUpdate(editor.id, value);
      }}
      readOnly={lockPage || isArchived}
    >
      {children}
    </Plate>
  );
}

export function PublicPlate({ children }: React.PropsWithChildren) {
  const templateDocument = useTemplateDocument();
  const [template, setTemplate] = useInitialLocalStorage<
    TemplateDocument | undefined
  >(`potion-2-${templateDocument?.id ?? "ai"}`, templateDocument);
  const value = template?.value;
  const id = template?.id;

  const editor = usePlateEditor({
    id,
    override: {
      enabled: {
        [KEYS.copilot]: id === "copilot",
      },
    },
    plugins: EditorKit,
    value,
  });

  const onDebouncedDocumentChange = useDebouncedCallback(
    (id: string, v: Value) => {
      setTemplate({
        id,
        icon: null,
        title: template?.title ?? "",
        value: v,
      });
    },
    1000
  );

  useWarnIfUnsavedChanges({ enabled: onDebouncedDocumentChange.isPending() });

  return (
    <Plate
      editor={editor}
      onValueChange={({ editor, value }) => {
        if (editor.meta.resetting) {
          editor.meta.resetting = undefined;
          return;
        }
        onDebouncedDocumentChange(editor.id, value);
      }}
    >
      {children}
    </Plate>
  );
}

export function PrintPlate({ children }: React.PropsWithChildren) {
  const searchParams = useSearchParams();
  const disableMedia = searchParams.get("disableMedia") === "true";

  const editor = useMemo(() => {
    const e = createPlateEditor({
      override: {
        enabled: {
          [KEYS.audio]: !disableMedia,
          [KEYS.file]: !disableMedia,
          [KEYS.img]: !disableMedia,
          [KEYS.mediaEmbed]: !disableMedia,
          [KEYS.video]: !disableMedia,
        },
      },
      plugins: BaseEditorKit,
    });
    e.meta.mode = "print";
    return e;
  }, [disableMedia]);

  return (
    <Plate editor={editor} readOnly>
      {children}
    </Plate>
  );
}
