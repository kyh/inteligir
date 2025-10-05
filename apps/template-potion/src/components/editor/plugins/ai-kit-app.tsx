'use client';

import type React from 'react';
import { useEffect } from 'react';

import { withAIBatch } from '@platejs/ai';
import {
  AIChatPlugin,
  AIPlugin,
  applyAISuggestions,
  streamInsertChunk,
  useChatChunk,
} from '@platejs/ai/react';
import { getPluginType, KEYS, PathApi } from 'platejs';
import { usePluginOption } from 'platejs/react';
import { useStickToBottom } from 'use-stick-to-bottom';

import { useChat } from '@/components/editor/use-chat-app';
import { CursorOverlayKit } from '@/registry/components/editor/plugins/cursor-overlay-kit';
import { MarkdownKit } from '@/registry/components/editor/plugins/markdown-kit';
import { AIMenu } from '@/registry/ui/ai-menu';
import { AIAnchorElement, AILeaf } from '@/registry/ui/ai-node';

export const aiChatPlugin = AIChatPlugin.extend({
  options: {
    contentRef: null as
      | (React.RefObject<HTMLElement | null> & React.RefCallback<HTMLElement>)
      | null,
    scrollRef: null as
      | (React.RefObject<HTMLElement | null> & React.RefCallback<HTMLElement>)
      | null,
  },
}).configure({
  render: {
    afterEditable: AIMenu,
    node: AIAnchorElement,
  },
  shortcuts: { show: { keys: 'mod+j' } },
  useHooks: ({ api, editor, getOption, setOptions }) => {
    const { contentRef, scrollRef } =
      useStickToBottom({
        /** Replace "bottom of the scroll container" with "top of the anchor" */
        targetScrollTop: (_defaultBottom, { scrollElement }) => {
          const anchorNode = api.aiChat.node({ anchor: true });

          if (!anchorNode) return 0; // fallback: real bottom

          const anchor = api.toDOMNode(anchorNode[0])?.parentElement
            ?.parentElement as HTMLDivElement;

          if (!anchor) return 0; // fallback: real bottom

          const scrollRect = scrollElement.getBoundingClientRect();
          const anchorRect = anchor.getBoundingClientRect();

          // Add a threshold of 100px from the bottom
          const threshold = 100;
          const isVisible =
            anchorRect.top >= scrollRect.top &&
            anchorRect.bottom <= scrollRect.bottom - threshold;

          const anchorTop = anchor.offsetTop - scrollElement.offsetTop;

          return isVisible ? 0 : anchorTop;
        },
      });

    useEffect(() => {
      setOptions({ contentRef, scrollRef });
    }, [contentRef, scrollRef, setOptions]);

    useChat();

    const mode = usePluginOption(AIChatPlugin, 'mode');
    const toolName = usePluginOption(AIChatPlugin, 'toolName');

    useChatChunk({
      onChunk: ({ chunk, isFirst, nodes, text: content }) => {
        if (isFirst && mode == 'insert') {
          editor.tf.withoutSaving(() => {
            editor.tf.insertNodes(
              {
                children: [{ text: '' }],
                type: getPluginType(editor, KEYS.aiChat),
              },
              {
                at: PathApi.next(editor.selection!.focus.path.slice(0, 1)),
              }
            );
          });
          editor.setOption(AIChatPlugin, 'streaming', true);
        }
        if (mode === 'insert' && nodes.length > 0) {
          withAIBatch(
            editor,
            () => {
              if (!getOption('streaming')) return;

              editor.tf.withScrolling(() => {
                streamInsertChunk(editor, chunk, {
                  textProps: {
                    [getPluginType(editor, KEYS.ai)]: true,
                  },
                });
              });
            },
            { split: isFirst }
          );
        }
        if (toolName === 'edit' && mode === 'chat') {
          withAIBatch(
            editor,
            () => {
              applyAISuggestions(editor, content);
            },
            {
              split: isFirst,
            }
          );
        }
      },
      onFinish: () => {
        editor.setOption(AIChatPlugin, 'streaming', false);
        editor.setOption(AIChatPlugin, '_blockChunks', '');
        editor.setOption(AIChatPlugin, '_blockPath', null);
        editor.setOption(AIChatPlugin, '_mdxName', null);
      },
    });
  },
});

export const AIKit = [
  ...CursorOverlayKit,
  ...MarkdownKit,
  AIPlugin.withComponent(AILeaf),
  aiChatPlugin,
];
