'use client';

import React from 'react';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { type Value, KEYS } from 'platejs';
import { Plate, usePlateEditor } from 'platejs/react';

import { EditorKit } from '@/components/editor/editor-kit-app';
import { useDebouncedCallback } from '@/hooks/useDebounceCallback';
import { useInitialLocalStorage } from '@/hooks/useLocalStorage';
import { useWarnIfUnsavedChanges } from '@/hooks/useWarnIfUnsavedChanges';
import { BaseEditorKit } from '@/registry/components/editor/editor-base-kit';
import { useUpdateDocumentValue } from '@/trpc/hooks/document-hooks';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

import {
  type TemplateDocument,
  useTemplateDocument,
} from './utils/useTemplateDocument';
import { getTemplateDocument } from './utils/useTemplateDocument';

export function DocumentPlate({ children }) {
  const updateDocumentValue = useUpdateDocumentValue();

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

  const value =
    templateId && !contentRich
      ? getTemplateDocument(templateId)?.value
      : (contentRich as Value);
  const editor = usePlateEditor({ id: documentId, plugins: EditorKit, value });

  return (
    <Plate
      readOnly={lockPage || isArchived}
      onValueChange={({ editor, value }) => {
        updateDocumentValue({ id: editor.id, value });
      }}
      editor={editor}
    >
      {children}
    </Plate>
  );
}

export function PublicPlate({ children }: React.PropsWithChildren) {
  const templateDocument = useTemplateDocument();
  const [template, setTemplate] = useInitialLocalStorage<
    TemplateDocument | undefined
  >(`potion-2-${templateDocument?.id ?? 'ai'}`, templateDocument);
  const value = template?.value;
  const id = template?.id;
  const editor = usePlateEditor({
    id,
    override: {
      enabled: {
        [KEYS.copilot]: id === 'copilot',
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
        title: template!.title,
        value: v,
      });
    },
    1000
  );

  useWarnIfUnsavedChanges({ enabled: onDebouncedDocumentChange.isPending() });

  return (
    <Plate
      onValueChange={({ editor, value }) => {
        if (editor.meta.resetting) {
          delete editor.meta.resetting;

          return;
        }

        onDebouncedDocumentChange(editor.id, value);
      }}
      editor={editor}
    >
      {children}
    </Plate>
  );
}

export function PrintPlate({ children }: React.PropsWithChildren) {
  const searchParams = useSearchParams();
  const disableMedia = searchParams.get('disableMedia') === 'true';

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
      ? getTemplateDocument(templateId).value
      : (contentRich as Value);

  const editor = usePlateEditor(
    {
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
    },
    [value]
  );
  editor.meta.mode = 'print';

  return (
    <Plate readOnly editor={editor}>
      {children}
    </Plate>
  );
}
