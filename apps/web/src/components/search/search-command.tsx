'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import React, { useEffect } from 'react';

import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { SearchStore, useSearchValue } from '@/components/search/SearchStore';
import { Icons } from '@/components/ui/icons';
import { useTParams } from '@/hooks/use-navigation';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/registry/hooks/use-debounce';
import { useMounted } from '@/registry/hooks/use-mounted';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/registry/ui/command';
import { useTRPC } from '@/trpc/react';

export const SearchCommand = () => {
  const { slug } = useTParams<'/dashboard/[slug]'>();
  const user = useCurrentUser();
  const router = useRouter();

  const searchRaw = useSearchValue('search');

  const search = useDebounce(searchRaw, 300);

  const { data } = useQuery({
    ...useTRPC().document.documents.queryOptions({ search }),
    enabled: !!user.id,
  });

  const mounted = useMounted();

  const isOpen = useSearchValue('isOpen');

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        if ((e.target as HTMLDivElement).dataset?.slateEditor) {
          return;
        }

        e.preventDefault();
        SearchStore.actions.toggle();
      }
    };
    document.addEventListener('keydown', down);

    return () => document.removeEventListener('keydown', down);
  }, []);

  const onSelect = (id: string) => {
    router.push(`/dashboard/${slug}/${id}` as Route);
    SearchStore.actions.onClose();
  };

  if (!mounted) return null;

  return (
    <CommandDialog
      className={cn(
        '[&_[cmdk-input-wrapper]]:mt-0 [&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:py-0'
      )}
      onOpenChange={(value) => {
        SearchStore.set('isOpen', value);
      }}
      open={isOpen}
    >
      <CommandInput
        onValueChange={(value) => SearchStore.actions.setSearch(value)}
        placeholder="Search a document..."
        value={searchRaw}
        variant="search"
      />

      <CommandList className="h-[520px] max-h-none">
        <CommandEmpty className="font-medium text-muted-foreground">
          No results
        </CommandEmpty>
        {/* <CommandGroup heading="Actions">
          <CommandItem
            className="mt-1 cursor-pointer"
            onSelect={() => setIsChat(true)}
            title="Ask Ai in current document"
          >
            <Icons.ai className="mr-2" />
            <span>Ask AI in current document</span>
          </CommandItem>
        </CommandGroup> */}
        <CommandGroup heading={`${data?.documents.length ? 'Documents' : ''}`}>
          {data?.documents.map((document) => (
            <CommandItem
              className="mt-1 cursor-pointer"
              key={document.id}
              onSelect={() => onSelect(document.id)}
              title={document.title || 'Untitled'}
              value={`${document.title}`}
            >
              {document.icon ? (
                <p className="mr-2 text-[18px]">{document.icon}</p>
              ) : (
                <Icons.file className="mr-2" />
              )}
              <span>{document.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
