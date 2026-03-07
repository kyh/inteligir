"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { KEYS, NodeIdPlugin, type Value } from "platejs";
import { createPlateEditor, Plate, usePlateEditor } from "platejs/react";
import React, { useMemo } from "react";

import { useSession } from "@/components/auth/useSession";
import { EditorKit } from "@/components/editor/editor-kit-app";
import { useDebouncedCallback } from "@/hooks/useDebounceCallback";
import { useInitialLocalStorage } from "@/hooks/useLocalStorage";
import { useWarnIfUnsavedChanges } from "@/hooks/useWarnIfUnsavedChanges";
import { BaseEditorKit } from "@/registry/components/editor/editor-base-kit";
import { api, useTRPC } from "@/trpc/react";
import { useDocumentQueryOptions } from "@/trpc/hooks/query-options";
import {
  getTemplateDocument,
  type TemplateDocument,
  useTemplateDocument,
} from "./utils/useTemplateDocument";

export function DocumentPlate({ children }: React.PropsWithChildren) {
  const session = useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const queryOptions = useDocumentQueryOptions();
  const { data: documentId } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.id,
  });
  const { data: lockPage } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.lockPage,
  });
  const { data: isArchived } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.isArchived,
  });
  const { data: templateId } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.templateId,
  });
  const { data: contentRich } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.contentRich,
  });

  const updateDocument = api.document.update.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.document.document.queryKey({ id: documentId! }),
      });
    },
  });

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
      userId: session?.user?.id,
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

  const queryOptions = useDocumentQueryOptions();

  const { data: templateId } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.templateId,
  });

  const { data: contentRich } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.contentRich,
  });

  const value =
    templateId && !contentRich
      ? getTemplateDocument(templateId)?.value
      : (contentRich as Value);

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
      value,
    });
    e.meta.mode = "print";
    return e;
  }, [value, disableMedia]);

  return (
    <Plate editor={editor} readOnly>
      {children}
    </Plate>
  );
}
