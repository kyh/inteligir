'use client';

import * as React from 'react';

import type { SuggestionConfig } from '@/registry/components/editor/plugins/suggestion-kit';
import type { TSuggestionData, TSuggestionText } from 'platejs';

import { CornerDownLeftIcon } from 'lucide-react';
import {
  type PlateLeafProps,
  type RenderNodeWrapper,
  PlateLeaf,
  useEditorPlugin,
  usePluginOption,
} from 'platejs/react';

import { cn } from '@/lib/utils';
import { suggestionPlugin } from '@/registry/components/editor/plugins/suggestion-kit';

export function SuggestionLeaf(props: PlateLeafProps<TSuggestionText>) {
  const { api, setOption } = useEditorPlugin(suggestionPlugin);

  const leafId: string = api.suggestion.nodeId(props.leaf) ?? '';
  const activeSuggestionId = usePluginOption(suggestionPlugin, 'activeId');
  const hoverSuggestionId = usePluginOption(suggestionPlugin, 'hoverId');
  const dataList = api.suggestion.dataList(props.leaf);

  const hasRemove = dataList.some((data) => data.type === 'remove');
  const hasActive = dataList.some((data) => data.id === activeSuggestionId);
  const hasHover = dataList.some((data) => data.id === hoverSuggestionId);

  const diffOperation = {
    type: hasRemove ? 'delete' : 'insert',
  } as const;

  const Component = (
    {
      delete: 'del',
      insert: 'ins',
      update: 'span',
    } as const
  )[diffOperation.type];

  return (
    <PlateLeaf
      {...props}
      as={Component}
      className={cn(
        'border-b-2 border-b-brand/[.24] bg-brand/[.08] text-brand/80 no-underline transition-colors duration-200',
        (hasActive || hasHover) && 'border-b-brand/[.60] bg-brand/[.13]',
        hasRemove &&
          'border-b-gray-300 bg-gray-300/25 text-gray-400 line-through',
        (hasActive || hasHover) &&
          hasRemove &&
          'border-b-gray-500 bg-gray-400/25 text-gray-500 no-underline'
      )}
      attributes={{
        ...props.attributes,
        onMouseEnter: () => setOption('hoverId', leafId),
        onMouseLeave: () => setOption('hoverId', null),
      }}
    />
  );
}

export const SuggestionLineBreak: RenderNodeWrapper<SuggestionConfig> = ({
  api,
  element,
}) => {
  if (!api.suggestion.isBlockSuggestion(element)) return;

  const suggestionData = element.suggestion;

  if (!suggestionData?.isLineBreak) return;

  return function Component({ children }) {
    return (
      <React.Fragment>
        {children}
        <SuggestionLineBreakContent suggestionData={suggestionData} />
      </React.Fragment>
    );
  };
};

function SuggestionLineBreakContent({
  suggestionData,
}: {
  suggestionData: TSuggestionData;
}) {
  const { type } = suggestionData;
  const isRemove = type === 'remove';
  const isInsert = type === 'insert';

  const activeSuggestionId = usePluginOption(suggestionPlugin, 'activeId');
  const hoverSuggestionId = usePluginOption(suggestionPlugin, 'hoverId');

  const isActive = activeSuggestionId === suggestionData.id;
  const isHover = hoverSuggestionId === suggestionData.id;

  const spanRef = React.useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={spanRef}
      className={cn(
        'absolute border-b-2 border-b-brand/[.24] bg-brand/[.08] text-justify text-brand/80 no-underline transition-colors duration-200',
        isInsert &&
          (isActive || isHover) &&
          'border-b-brand/[.60] bg-brand/[.13]',
        isRemove &&
          'border-b-gray-300 bg-gray-300/25 text-gray-400 line-through',
        isRemove &&
          (isActive || isHover) &&
          'border-b-gray-500 bg-gray-400/25 text-gray-500 no-underline'
      )}
      style={{
        bottom: 4.5,
        height: 21,
      }}
      contentEditable={false}
    >
      <CornerDownLeftIcon className="mt-0.5 size-4" />
    </span>
  );
}
