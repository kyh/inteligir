'use client';

import { getCommentCount } from '@platejs/comment';
import type { TCommentText } from 'platejs';
import {
  PlateLeaf,
  type PlateLeafProps,
  useEditorPlugin,
  usePluginOption,
} from 'platejs/react';

import { cn } from '@/lib/utils';
import { commentPlugin } from '@/registry/components/editor/plugins/comment-kit';

export function CommentLeaf(props: PlateLeafProps<TCommentText>) {
  const { api, setOption } = useEditorPlugin(commentPlugin);
  const hoverId = usePluginOption(commentPlugin, 'hoverId');
  const activeId = usePluginOption(commentPlugin, 'activeId');

  const isOverlapping = getCommentCount(props.leaf) > 1;
  const currentId = api.comment.nodeId(props.leaf);
  const isActive = activeId === currentId;
  const isHover = hoverId === currentId;

  return (
    <PlateLeaf
      {...props}
      attributes={{
        ...props.attributes,
        onClick: () => setOption('activeId', currentId ?? null),
        onMouseEnter: () => setOption('hoverId', currentId ?? null),
        onMouseLeave: () => setOption('hoverId', null),
      }}
      className={cn(
        'border-b-2 border-b-highlight/[.36] bg-highlight/[.13] transition-colors duration-200',
        (isHover || isActive) && 'border-b-highlight bg-highlight/25',
        isOverlapping && 'border-b-2 border-b-highlight/[.7] bg-highlight/25',
        (isHover || isActive) &&
          isOverlapping &&
          'border-b-highlight bg-highlight/45'
      )}
    />
  );
}
