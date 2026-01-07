'use client';

import { useQuery } from '@tanstack/react-query';
import { useEditorRef } from 'platejs/react';
import React, { type ElementRef, useRef } from 'react';

import { Icons } from '@/components/ui/icons';
import { useTParams } from '@/hooks/use-navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/registry/ui/button';
import { Input } from '@/registry/ui/input';
import {
  useUpdateDocumentMutation,
  useUpdateDocumentTitle,
} from '@/trpc/hooks/document-hooks';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

import { useAuthGuard } from '../auth/useAuthGuard';
import { getTemplateDocument } from '../editor/utils/useTemplateDocument';
import { DocumentIconPicker } from './document-icon-picker';

export const DocumentToolbar = ({ preview }: { preview?: boolean }) => {
  const authGuard = useAuthGuard();
  const { documentId } = useTParams<'/[documentId]'>();
  const editor = useEditorRef();
  const queryOptions = useDocumentQueryOptions();

  const { data: icon } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.icon,
  });

  const { data: isArchived } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.isArchived,
  });

  let { data: title } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.title,
  });
  title = queryOptions.enabled ? title : getTemplateDocument(documentId ?? '')?.title;

  const { data: fullWidth } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.fullWidth,
  });

  const { data: coverImage } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.coverImage,
  });

  const inputRef = useRef<ElementRef<'input'>>(null);
  const updateTitle = useUpdateDocumentTitle();
  const updateDocument = useUpdateDocumentMutation();

  const readOnly = preview || isArchived;

  return (
    <div
      className={cn(
        'group relative flex flex-col justify-end',
        !coverImage && !icon && 'sm:min-h-[160px]',
        !coverImage && icon && 'sm:min-h-[265px]',
        'px-16 sm:px-[max(64px,calc(50%-350px))]',
        fullWidth && 'px-16 sm:px-24'
      )}
      data-plate-selectable
    >
      {!!icon &&
        (readOnly ? (
          <p className="pt-6 text-6xl">{icon}</p>
        ) : (
          <DocumentIconPicker>
            <Button
              className={cn(
                'size-[78px] text-[78px] hover:bg-accent/30',
                coverImage && 'mt-[-42px]'
              )}
              size="none"
              variant="ghost"
            >
              {icon}
            </Button>
          </DocumentIconPicker>
        ))}

      <div className="flex items-center py-2 opacity-0 group-hover:opacity-100">
        {!icon && !readOnly && (
          <DocumentIconPicker asChild>
            <Button variant="ghost3">
              <Icons.smile variant="muted" />
              Add Icon
            </Button>
          </DocumentIconPicker>
        )}
        {!coverImage && !readOnly && documentId && (
          <Button
            onClick={() => {
              authGuard(() => {
                updateDocument.mutate({
                  id: documentId,
                  coverImage: 'misty',
                });
              });
            }}
            variant="ghost3"
          >
            <Icons.image variant="muted" />
            Add cover
          </Button>
        )}
      </div>

      <Input
        className="h-auto w-full resize-none break-words rounded-none bg-transparent p-0 font-bold text-4xl! text-[#3F3F3F] leading-none outline-hidden dark:text-[#CFCFCF]"
        onChange={(e) => {
          if (!documentId) return;
          authGuard(() => {
            updateTitle({
              id: documentId,
              title: e.target.value,
            });
          });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            editor.tf.focus();
          }
        }}
        placeholder="Untitled"
        readOnly={readOnly}
        ref={inputRef}
        value={title ?? ''}
        variant="link"
      />
    </div>
  );
};
