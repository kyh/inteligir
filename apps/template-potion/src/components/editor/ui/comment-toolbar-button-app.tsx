'use client';

import { MessageSquareTextIcon } from 'lucide-react';
import { useEditorRef } from 'platejs/react';

import { useAuthGuard } from '@/components/auth/useAuthGuard';
import { commentPlugin } from '@/registry/components/editor/plugins/comment-kit';
import { ToolbarButton } from '@/registry/ui/toolbar';

export function CommentToolbarButton() {
  const editor = useEditorRef();

  const authGuard = useAuthGuard();

  return (
    <ToolbarButton
      onClick={() => {
        authGuard(() => {
          editor.getTransforms(commentPlugin).comment.setDraft();
        });
      }}
      data-plate-prevent-overlay
      shortcut="⌘+Shift+M"
      tooltip="Comment"
    >
      <MessageSquareTextIcon className="mr-1" />
      <span className="hidden sm:inline">Comment</span>
    </ToolbarButton>
  );
}
