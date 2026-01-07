'use client';

import { useLink } from '@platejs/link/react';
import {
  ArrowUpRightIcon,
  CopyIcon,
  FileTextIcon,
  LinkIcon,
} from 'lucide-react';
import React, { useEffect } from 'react';

export const mockRecentDocuments = [
  {
    id: 'docs/examples/ai',
    icon: '📋',
    title: 'AI',
  },
  {
    id: 'docs/examples/callout',
    icon: '🧰',
    title: 'Callout',
  },
  {
    id: 'docs/examples/equation',
    icon: '🧮',
    title: 'Equation',
  },
  {
    id: 'docs/examples/toc',
    icon: '📚',
    title: 'Table of Contents',
  },
];

import { SuggestionPlugin } from '@platejs/suggestion/react';
import type { TInlineSuggestionData } from 'platejs';
import {
  PlateElement,
  type PlateElementProps,
  useEditorPlugin,
  useElement,
  usePluginOption,
} from 'platejs/react';
import { cn } from '@/lib/utils';
import type { MyLinkElement } from '@/registry/components/editor/plate-types';
import { linkPlugin } from '@/registry/components/editor/plugins/link-kit';

import { Button } from './button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';

export function LinkElement(props: PlateElementProps) {
  const element = useElement<MyLinkElement>();
  const { props: linkProps } = useLink({ element });
  const { api, setOption } = useEditorPlugin(linkPlugin);

  const activeLinkId = usePluginOption(linkPlugin, 'activeId');
  const mode = usePluginOption(linkPlugin, 'mode');
  const open = activeLinkId === element.id && mode === 'hover';

  const isInternal = element.url.startsWith('/');

  const onCopy = () => {
    const urlToCopy = isInternal
      ? `${window.location.origin}${element.url}`
      : element.url;

    void navigator.clipboard.writeText(urlToCopy);
  };

  const suggestionData = props.editor
    .getApi(SuggestionPlugin)
    .suggestion.suggestionData(props.element) as
    | TInlineSuggestionData
    | undefined;

  return (
    <HoverCard
      closeDelay={0}
      onOpenChange={(open) => {
        setOption('mode', open ? 'hover' : null);
        setOption('activeId', open ? element.id : null);
      }}
      open={open}
      openDelay={0}
    >
      <HoverCardTrigger asChild>
        <span>
          <PlateElement
            as="a"
            {...props}
            attributes={{
              ...props.attributes,
              ...(linkProps as any),
              onClick: () => {
                window.open(element.url, isInternal ? '_self' : '_blank');
              },
              onMouseDown: (e) => e.preventDefault(),
            }}
            className={cn(
              'cursor-pointer border-b-1 font-medium text-primary/65',
              suggestionData?.type === 'remove' &&
                'border-b-gray-300 bg-gray-300/25 text-gray-400 line-through',
              suggestionData?.type === 'insert' &&
                'border-b-brand/[.60] bg-brand/[.13]'
            )}
          >
            {props.children}
          </PlateElement>
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-fit animate-none px-1.5 py-1 transition-none">
        <div className="flex items-center">
          <LinkPreview element={element} />
          <Button
            className="ml-1 shrink-0 px-2 py-1"
            onClick={onCopy}
            variant="ghost"
          >
            <CopyIcon className="size-3! shrink-0" />
          </Button>
          <Button
            className="shrink-0 px-2 py-1"
            onClick={() => {
              setOption('activeId', element.id);
              api.a.show({ linkElement: element, mode: 'edit' });
            }}
            variant="ghost"
          >
            <span className="text-xs">Edit</span>
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

const LinkPreview = ({ element }: { element: MyLinkElement }) => {
  const { editor } = useEditorPlugin(linkPlugin);

  const isInternal = element.url.startsWith('/');

  const document = mockRecentDocuments.find(
    (template) => template.id === element.url.slice(1)
  );

  const Icon = (
    <span>
      {element.icon ? (
        <span>{element.icon}</span>
      ) : (
        <FileTextIcon className="size-4" />
      )}
    </span>
  );

  useEffect(() => {
    if (!document) return;
    if (document.title !== element.title || document.icon !== element.icon) {
      editor.tf.setNodes(
        { icon: document.icon, title: document.title },
        {
          at: [],
          mode: 'lowest',
          match: (n) => n.type === linkPlugin.key && n.id === element.id,
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document]);

  return (
    <div className="flex items-center gap-1 text-primary/65">
      {isInternal ? (
        <>
          <span className="relative mr-3">
            {Icon}
            <ArrowUpRightIcon className="-right-3 absolute bottom-0 size-3.5 font-bold" />
          </span>
          <span className="h-6 max-w-[200px] truncate text-sm leading-6">
            {element.title}
          </span>
        </>
      ) : (
        <>
          <LinkIcon className="mt-px mr-1 size-3.5 shrink-0" />
          <span className="h-6 max-w-[200px] truncate text-sm leading-6">
            {element.url}
          </span>
        </>
      )}
    </div>
  );
};
