'use client';

import { useEffect } from 'react';

import { debounce } from 'lodash';
import { useEditorContainerRef } from 'platejs/react';

import { BlockDiscussion } from '@/components/editor/ui/block-discussion-app';
import { FloatingDiscussion } from '@/components/editor/ui/floating-discussion-app';
import { commentPlugin as CommentPlugin } from '@/registry/components/editor/plugins/comment-kit';
import { CommentLeaf } from '@/registry/ui/comment-node';

export const commentPlugin = CommentPlugin.configure({
  render: {
    // Instead of discussion-kit
    aboveNodes: BlockDiscussion,
    afterEditable: FloatingDiscussion,
    node: CommentLeaf,
  },
  shortcuts: {
    setDraft: { keys: 'mod+shift+m' },
  },
  useHooks: ({ editor, setOption }) => {
    const editorContainerRef = useEditorContainerRef();

    useEffect(() => {
      if (!editorContainerRef.current) return;

      const editable = editor.api.toDOMNode(editor);

      if (!editable) return;

      const handleResize = debounce(() => {
        const styles = window.getComputedStyle(editable);
        const isOverlap = Number.parseInt(styles.paddingRight) < 80 + 288;

        setOption('isOverlapWithEditor', isOverlap);
      }, 100);

      window.addEventListener('resize', handleResize);
      handleResize();

      return () => {
        window.removeEventListener('resize', handleResize);
        handleResize.cancel();
      };
    }, [editor, editorContainerRef, setOption]);
  },
});

export const CommentKit = [commentPlugin];
