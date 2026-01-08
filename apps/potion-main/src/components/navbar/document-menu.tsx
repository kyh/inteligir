'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { TextStyle } from 'generated/prisma/enums';
import { ArrowDownToLineIcon, ArrowUpToLineIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEditorRef } from 'platejs/react';
import React, { useCallback, useMemo } from 'react';
import { toast } from 'sonner';

import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { pushModal } from '@/components/modals';
import { useTParams } from '@/hooks/use-navigation';
import { cn } from '@/lib/utils';
import { useMounted } from '@/registry/hooks/use-mounted';
import { Button } from '@/registry/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/ui/dropdown-menu';
import {
  useArchiveDocumentMutation,
  useUpdateDocumentMutation,
} from '@/trpc/hooks/document-hooks';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

import { useAuthGuard } from '../auth/useAuthGuard';
import { getEditorWordCount } from '../editor/utils';
import { Icons } from '../ui/icons';
import { Skeleton } from '../ui/skeleton';
import { Switch } from '../ui/switch';

export const TEXT_STYLE_ITEMS: {
  key: TextStyle;
  fontFamily: string;
  label: string;
  tooltip: string;
}[] = [
  {
    key: TextStyle.DEFAULT,
    fontFamily: 'inherit',
    label: 'Default',
    tooltip: 'Standard sans-serif',
  },
  {
    key: TextStyle.SERIF,
    fontFamily: 'Lyon-Text, Georgia, ui-serif, serif',
    label: 'Serif',
    tooltip: 'Elegant style for formal writing',
  },
  {
    key: TextStyle.MONO,
    fontFamily: 'iawriter-mono, Nitti, Menlo, Courier, monospace',
    label: 'Mono',
    tooltip: 'Fixed-width font for code',
  },
];

const SWITCH_ITEMS: {
  key: 'fullWidth' | 'lockPage' | 'smallText' | 'toc';
  label: string;
}[] = [
  {
    key: 'smallText',
    label: 'Small text',
  },
  {
    key: 'fullWidth',
    label: 'Full width',
  },
  {
    key: 'lockPage',
    label: 'Lock page',
  },
  {
    key: 'toc',
    label: 'Table of contents',
  },
];

export const DocumentMenu = React.memo(() => {
  const mounted = useMounted();

  if (!mounted) {
    return (
      <Button size="icon" variant="ghost">
        <Icons.moreX size="md" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <Icons.moreX size="md" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" alignOffset={8} className="w-60">
        <DocumentMenuContent />
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

function DocumentMenuContent() {
  const authGuard = useAuthGuard();
  const { documentId } = useTParams<'/[documentId]'>();
  const editor = useEditorRef();
  const queryOptions = useDocumentQueryOptions();

  const wordCount = useMemo(() => getEditorWordCount(editor), [editor]);

  const { data: updatedAt } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.updatedAt,
  });

  const { data: textStyle } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.textStyle,
  });

  const { data: lockPage } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.lockPage,
  });

  const { data: smallText } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.smallText,
  });

  const { data: fullWidth } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.fullWidth,
  });

  const { data: toc } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.toc,
  });

  const documentCustom = React.useMemo(
    () => ({
      fullWidth,
      lockPage,
      smallText,
      textStyle: textStyle ?? TextStyle.DEFAULT,
      toc: toc ?? true,
    }),
    [fullWidth, lockPage, smallText, textStyle, toc]
  );

  const router = useRouter();

  const archiveDocument = useArchiveDocumentMutation();
  const updateDocument = useUpdateDocumentMutation();

  const user = useCurrentUser();
  const onArchive = () => {
    const promise = archiveDocument.mutateAsync({ id: documentId });

    toast.promise(promise, {
      error: 'Failed to archive note!',
      loading: 'Moving to trash...',
      success: 'Note moved to trash.',
    });

    router.push('/');
  };

  const onCustomDocument = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement, MouseEvent>,
      key: 'fullWidth' | 'lockPage' | 'smallText' | 'textStyle' | 'toc',
      value: TextStyle | boolean
    ) => {
      e.preventDefault();
      updateDocument.mutate({ [key]: value, id: documentId });
    },
    [documentId, updateDocument]
  );

  return (
    <>
      <DropdownMenuGroup className="grid grid-cols-3 gap-0.5 px-3 py-1.5">
        {TEXT_STYLE_ITEMS.map((item) => (
          <DropdownMenuItem
            asChild
            key={item.key}
            onClick={(e) =>
              authGuard(() => onCustomDocument(e, 'textStyle', item.key))
            }
            size="none"
          >
            <Button
              className="flex h-auto w-full flex-col justify-between px-1.5 pt-2.5 pb-1.5 text-xs"
              tooltip={item.tooltip}
              tooltipContentProps={{ side: 'bottom' }}
              variant="ghost"
            >
              <div
                className={cn(
                  'font-medium text-[24px] text-foreground',
                  item.key === documentCustom.textStyle && 'text-brand'
                )}
                style={{ fontFamily: item.fontFamily }}
              >
                Ag
              </div>
              <span className="text-xs"> {item.label}</span>
            </Button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup className="py-1.5">
        {SWITCH_ITEMS.map((item) => (
          <DropdownMenuItem
            className="flex items-center justify-between"
            key={item.label}
            onClick={(e) =>
              authGuard(() =>
                onCustomDocument(e, item.key, !documentCustom[item.key])
              )
            }
          >
            <span>{item.label}</span>
            <Switch checked={documentCustom[item.key]} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => authGuard(onArchive)}>
          <Icons.trash />
          Move to Trash
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            editor.undo();
          }}
        >
          <Icons.undo />
          Undo
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            authGuard(() => {
              pushModal('VersionHistory', {
                activeVersionId: 1,
              });
            })
          }
        >
          <Icons.history />
          Version history
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => authGuard(() => pushModal('Import'))}>
          <ArrowDownToLineIcon />
          Import
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => authGuard(() => pushModal('Export'))}>
          <ArrowUpToLineIcon />
          Export
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />

      <div className="space-y-1 p-3 text-muted-foreground/90 text-xs">
        <div>Word count: {wordCount}</div>
        <div>Last edited by {user?.name}</div>
        <div>
          {updatedAt && format(new Date(updatedAt), 'MMM d, yyyy, h:mm a')}
        </div>
      </div>
    </>
  );
}

export function DocumentMenuSkeleton() {
  return <Skeleton className="mt-1 h-6 w-10" />;
}
