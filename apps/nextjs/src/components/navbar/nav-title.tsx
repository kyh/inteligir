'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { useTParams } from '@/hooks/use-navigation';
import { Button } from '@/registry/ui/button';
import { Input } from '@/registry/ui/input';
import { useUpdateDocumentTitle } from '@/trpc/hooks/document-hooks';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

import { useAuthGuard } from '../auth/useAuthGuard';
import { getTemplateDocument } from '../editor/utils/useTemplateDocument';
import { Skeleton } from '../ui/skeleton';

export const NavTitle = () => {
  const authGuard = useAuthGuard();
  const { documentId } = useTParams<'/dashboard/[slug]/[documentId]'>();

  const queryOptions = useDocumentQueryOptions();
  const { data: _title, isLoading } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.title,
  });
  const title = queryOptions.enabled
    ? _title
    : getTemplateDocument(documentId)?.title;

  const { data: icon } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.icon,
  });

  const { data: isArchived } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.isArchived,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const updateTitle = useUpdateDocumentTitle();

  const enableInput = () => {
    if (isArchived) return;

    setIsEditing(true);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.value = title ?? '';
        inputRef.current.setSelectionRange(0, inputRef.current.value.length);
      }
    }, 0);
  };

  const disableInput = () => {
    setIsEditing(false);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateTitle({ id: documentId, title: e.target.value });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      disableInput();
    }
  };

  if (isLoading) {
    return <NavTitleSkeleton />;
  }

  return (
    <div className="flex items-center gap-x-1">
      {!!icon && <p className="select-none">{icon}</p>}
      {isEditing ? (
        <Input
          className="h-7 px-2"
          onBlur={disableInput}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Untitled"
          // onClick={enableInput}
          ref={inputRef}
          variant="flat"
        />
      ) : (
        <Button
          className="line-clamp-1 h-auto p-1"
          onClick={() => authGuard(enableInput)}
          variant="ghost"
        >
          <div className="w-[180px] truncate text-left">{title}</div>
        </Button>
      )}
    </div>
  );
};

export function NavTitleSkeleton() {
  return <Skeleton className="h-[28px] w-20 rounded-md" />;
}
