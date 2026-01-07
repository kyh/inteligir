'use client';

import { getCommentKey, getDraftCommentKey } from '@platejs/comment';
import { CommentPlugin, useCommentId } from '@platejs/comment/react';
import { produce } from 'immer';
import { NodeApi, type Value } from 'platejs';
import { Plate, useEditorPlugin, useEditorRef } from 'platejs/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { commentPlugin } from '@/components/editor/plugins/comment-kit-app';
import { Icons } from '@/components/ui/icons';
import { useTParams } from '@/hooks/use-navigation';
import { formatCommentDate } from '@/lib/date/formatDate';
import { mergeDefined } from '@/lib/mergeDefined';
import { omitNil } from '@/lib/omitNull';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/registry/ui/avatar';
import { Button } from '@/registry/ui/button';
import { useCommentEditor } from '@/registry/ui/comment';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/registry/ui/dropdown-menu';
import { Editor, EditorContainer } from '@/registry/ui/editor';
import type { RouterCommentItem } from "@/types";
import { api, useTRPC } from '@/trpc/react';

export function Comment(props: {
  comment: RouterCommentItem;
  discussionLength: number;
  documentContent: string;
  editingId: string | null;
  index: number;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  showDocumentContent?: boolean;
  onEditorClick?: () => void;
}) {
  const {
    comment,
    discussionLength,
    documentContent,
    editingId,
    index,
    setEditingId,
    showDocumentContent = false,
    onEditorClick,
  } = props;
  const { user } = comment;

  const trpc = useTRPC();
  const { documentId } = useTParams<'/[documentId]'>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const discussions = trpc.comment.discussions as any;
  const resolveDiscussion = api.comment.resolveDiscussion.useMutation({
    onError(_, __, context: any) {
      if (context?.previousDiscussions && documentId) {
        discussions.setData(
          { documentId },
          context.previousDiscussions
        );
      }
    },
    onMutate: async (input) => {
      if (!documentId) return;
      await discussions.cancel();
      const previousDiscussions = discussions.getData({
        documentId,
      });

      discussions.setData({ documentId }, (old: any) =>
        produce(old, (draft: any) => {
          if (!draft) return draft;

          const index = draft.discussions.findIndex(
            (comment: any) => comment.id === input.id
          );

          if (index === -1) return;

          draft.discussions[index].isResolved = true;
        })
      );

      return { previousDiscussions };
    },
    onSuccess: () => {
      if (documentId) void discussions.invalidate({ documentId });
    },
  });

  const removeDiscussion = api.comment.removeDiscussion.useMutation({
    onError(_, __, context: any) {
      if (context?.previousDiscussions && documentId) {
        discussions.setData(
          { documentId },
          context.previousDiscussions
        );
      }
    },
    onMutate: async (input) => {
      if (!documentId) return;
      await discussions.cancel();
      const previousDiscussions = discussions.getData({
        documentId,
      });

      discussions.setData({ documentId }, (old: any) =>
        produce(old, (draft: any) => {
          if (!draft) return draft;

          const index = draft.discussions.findIndex(
            (comment: any) => comment.id === input.id
          );

          if (index === -1) return;

          draft.discussions.splice(index, 1);
        })
      );

      return { previousDiscussions };
    },
    onSuccess: () => {
      if (documentId) void discussions.invalidate({ documentId });
    },
  });

  const updateComment = api.comment.updateComment.useMutation({
    onError(_, __, context: any) {
      if (context?.previousDiscussions && documentId) {
        discussions.setData(
          { documentId },
          context.previousDiscussions
        );
      }
    },
    onMutate: async (input) => {
      if (!documentId) return;
      await discussions.cancel();
      const previousDiscussions = discussions.getData({
        documentId,
      });

      discussions.setData({ documentId }, (old: any) =>
        produce(old, (draft: any) => {
          if (!draft) return draft;

          const discussionsIndex = draft.discussions.findIndex(
            (discussion: any) => discussion.id === input.discussionId
          );

          if (discussionsIndex === -1) return;

          const replyIndex = draft.discussions[
            discussionsIndex
          ].comments.findIndex((comment: any) => comment.id === input.id);

          if (replyIndex === -1) return;

          const draftDiscussion = draft.discussions[discussionsIndex];
          const comment = draftDiscussion.comments[replyIndex];

          comment.isEdited = true;
          comment.contentRich = input.contentRich as any;
          comment.updatedAt = new Date();
        })
      );

      return { previousDiscussions };
    },
    onSuccess: () => {
      if (documentId) void discussions.invalidate({ documentId });
    },
  });

  const { id: currentUserId } = useCurrentUser();
  const { tf } = useEditorPlugin(commentPlugin);

  const isMyComment = useMemo(
    () => currentUserId === user.id,
    [currentUserId, user.id]
  );

  const initialValue = comment.contentRich as Value;

  const commentEditor = useCommentEditor(
    {
      id: comment.id,
      value: initialValue,
    },
    [initialValue]
  );

  const onCancel = () => {
    setEditingId(null);
    commentEditor.tf.replaceNodes(initialValue, {
      at: [],
      children: true,
    });
  };

  const onSave = () => {
    updateComment.mutate({
      id: comment.id,
      contentRich: commentEditor.children,
      discussionId: comment.discussionId,
      isEdited: true,
    });
    setEditingId(null);
  };

  const onResolveComment = () => {
    resolveDiscussion.mutate({ id: comment.discussionId });
    tf.comment.unsetMark({ id: comment.discussionId });
  };

  const isFirst = index === 0;
  const isLast = index === discussionLength - 1;
  const isEditing = editingId && editingId === comment.id;

  const [hovering, setHovering] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="relative flex items-center">
        {user && (
          <Avatar className="mr-2 size-6">
            <AvatarImage alt={user.name!} src={user.image!} />
            <AvatarFallback>{user.name?.[0]}</AvatarFallback>
          </Avatar>
        )}

        <h4 className="font-semibold text-sm leading-none">{user?.name}</h4>

        <div className="ml-1.5 text-muted-foreground/80 text-xs leading-none">
          <span className="mr-1">{formatCommentDate(comment.createdAt)}</span>
          {comment.isEdited && <span>(edited)</span>}
        </div>

        {isMyComment && (hovering || dropdownOpen) && (
          <div className="absolute top-0 right-0 flex">
            {index === 0 && (
              <Button
                className="mr-1 h-6 p-1 text-muted-foreground"
                onClick={onResolveComment}
                tooltip="Resolve"
                type="button"
                variant="ghost"
              >
                <Icons.check className="size-4" />
              </Button>
            )}

            <CommentMoreDropdown
              comment={comment}
              dropdownOpen={dropdownOpen}
              onCloseAutoFocus={() => {
                setTimeout(() => {
                  commentEditor.tf.focus({ edge: 'endEditor' });
                }, 0);
              }}
              onRemoveComment={() => {
                if (discussionLength === 1) {
                  tf.comment.unsetMark({ id: comment.discussionId });
                  removeDiscussion.mutate({ id: comment.discussionId });
                }
              }}
              setDropdownOpen={setDropdownOpen}
              setEditingId={setEditingId}
            />
          </div>
        )}
      </div>

      {isFirst && showDocumentContent && (
        <div className="relative mt-1 flex pl-[32px] text-sm text-subtle-foreground">
          {discussionLength > 1 && (
            <div className="absolute top-[5px] left-3 h-full w-0.5 shrink-0 bg-muted" />
          )}
          <div className="my-px w-0.5 shrink-0 bg-highlight" />
          <div className="ml-2">{documentContent}</div>
        </div>
      )}

      <div className="relative my-1 pl-[26px]">
        {!isLast && (
          <div className="absolute top-0 left-3 h-full w-0.5 shrink-0 bg-muted" />
        )}
        <Plate editor={commentEditor} readOnly={!isEditing}>
          <EditorContainer variant="comment">
            <Editor
              className="w-auto grow"
              onClick={() => onEditorClick?.()}
              variant="comment"
            />

            {isEditing && (
              <div className="ml-auto flex shrink-0 gap-1">
                <Button
                  className="size-[28px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onCancel();
                  }}
                  size="iconSm"
                  variant="ghost"
                >
                  <div className="flex size-5 items-center justify-center rounded-full bg-primary/40">
                    <Icons.x className="!size-3 stroke-[3px] text-background" />
                  </div>
                </Button>

                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    void onSave();
                  }}
                  size="iconSm"
                  variant="ghost"
                >
                  <div className="flex size-5 items-center justify-center rounded-full bg-brand">
                    <Icons.check className="!size-3 stroke-[3px] text-background" />
                  </div>
                </Button>
              </div>
            )}
          </EditorContainer>
        </Plate>
      </div>
    </div>
  );
}

function CommentMoreDropdown(props: {
  comment: RouterCommentItem;
  dropdownOpen: boolean;
  setDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  onCloseAutoFocus?: () => void;
  onRemoveComment?: () => void;
}) {
  const {
    comment,
    dropdownOpen,
    setDropdownOpen,
    setEditingId,
    onCloseAutoFocus,
    onRemoveComment,
  } = props;

  const trpc = useTRPC();
  const { documentId } = useTParams<'/[documentId]'>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const discussionsUtils = trpc.comment.discussions as any;
  const deleteComment = api.comment.deleteComment.useMutation({
    onError(_, __, context: any) {
      if (context?.previousDiscussions && documentId) {
        discussionsUtils.setData(
          { documentId },
          context.previousDiscussions
        );
      }
    },
    onMutate: async (input) => {
      if (!documentId) return;
      await discussionsUtils.cancel();
      const previousDiscussions = discussionsUtils.getData({
        documentId,
      });

      discussionsUtils.setData({ documentId }, (old: any) =>
        produce(old, (draft: any) => {
          if (!draft) return draft;

          const discussionIdx = draft.discussions.findIndex(
            (discussion: any) => discussion.id === input.discussionId
          );

          if (discussionIdx === -1) return;

          const draftDiscussion = draft.discussions[discussionIdx];

          const replyIndex = draftDiscussion.comments.findIndex(
            (comment: any) => comment.id === input.id
          );

          draftDiscussion.comments.splice(replyIndex, 1);
        })
      );

      return { previousDiscussions };
    },
    onSuccess: () => {
      if (documentId) void discussionsUtils.invalidate({ documentId });
      onRemoveComment?.();
    },
  });

  const selectedEditCommentRef = React.useRef<boolean>(false);

  const onDeleteComment = React.useCallback(() => {
    if (!comment.id) {
      alert('You are operating too quickly, please try again later.');
      return;
    }

    deleteComment.mutate({
      id: comment.id,
      discussionId: comment.discussionId,
    });
  }, [comment.discussionId, comment.id, deleteComment]);

  const onEditComment = React.useCallback(() => {
    selectedEditCommentRef.current = true;

    if (!comment.id) {
      alert('You are operating too quickly, please try again later.');
      return;
    }

    setEditingId(comment.id);
  }, [comment.id, setEditingId]);

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={setDropdownOpen}
      open={dropdownOpen}
    >
      <DropdownMenuTrigger asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <Button
          className="h-6 p-1 text-muted-foreground"
          tooltip="More actions"
          variant="ghost"
        >
          <Icons.more className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48"
        onCloseAutoFocus={(e: React.FocusEvent) => {
          if (selectedEditCommentRef.current) {
            onCloseAutoFocus?.();
            selectedEditCommentRef.current = false;
          }

          return e.preventDefault();
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onEditComment}>
            <Icons.edit className="size-4" />
            Edit comment
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDeleteComment}>
            <Icons.trash className="size-4" />
            Delete comment
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CommentCreateForm({
  autoFocus = false,
  className,
  discussionId: discussionIdProp,
  focusOnMount = false,
  isSuggesting,
}: {
  autoFocus?: boolean;
  className?: string;
  discussionId?: string;
  focusOnMount?: boolean;
  isSuggesting?: boolean;
}) {
  const trpc = useTRPC();
  const current = useCurrentUser();
  const { documentId } = useTParams<'/[documentId]'>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const discussionsHook = trpc.comment.discussions as any;

  const createComment = api.comment.createComment.useMutation({
    onError(_, __, context: any) {
      if (context?.previousDiscussions && documentId) {
        discussionsHook.setData(
          { documentId },
          context.previousDiscussions
        );
      }
    },
    onMutate: async (input) => {
      if (!documentId) return;
      await discussionsHook.cancel();
      const previousDiscussions = discussionsHook.getData({
        documentId,
      });

      discussionsHook.setData({ documentId }, (old: any) =>
        produce(old, (draft: any) => {
          if (!draft) return draft;

          const comments = draft.discussions.find(
            (comment: any) => comment.id === input.discussionId
          )?.comments;

          const newUserInfo = mergeDefined(omitNil(input), {
            createdAt: new Date(),
            updatedAt: new Date(),
            user: omitNil(current),
          });

          comments?.push(newUserInfo);
        })
      );

      return { previousDiscussions };
    },
    onSuccess: () => {
      if (documentId) void discussionsHook.invalidate({ documentId });
    },
  });
  const createDiscussionWithComment =
    api.comment.createDiscussionWithComment.useMutation({
      onError(_, __, context: any) {
        if (context?.previousDiscussions && documentId) {
          discussionsHook.setData(
            { documentId },
            context.previousDiscussions
          );
        }
      },
      onMutate: async () => {
        if (!documentId) return;
        await discussionsHook.cancel();
        const previousDiscussions = discussionsHook.getData({
          documentId,
        });

        return { previousDiscussions };
      },
      onSuccess: () => {
        if (documentId) void discussionsHook.invalidate({ documentId });
      },
    });

  const editor = useEditorRef();
  const currentUser = useCurrentUser();
  const discussionId = useCommentId() ?? discussionIdProp;
  const [resetKey, setResetKey] = React.useState(0);

  const [commentValue, setCommentValue] = React.useState<Value | undefined>();
  const commentContent = useMemo(
    () =>
      commentValue
        ? NodeApi.string({ children: commentValue as any, type: 'p' })
        : '',
    [commentValue]
  );
  const commentEditor = useCommentEditor({}, [resetKey]);

  useEffect(() => {
    if (commentEditor && focusOnMount) {
      commentEditor.tf.focus();
    }
  }, [commentEditor, focusOnMount]);

  const onAddComment = React.useCallback(async () => {
    setResetKey((prev) => prev + 1);

    if (discussionId) {
      createComment.mutate({
        contentRich: commentValue as any,
        discussionId,
      });

      return;
    }

    const commentsNodeEntry = editor
      .getApi(CommentPlugin)
      .comment.nodes({ at: [], isDraft: true });

    if (commentsNodeEntry.length === 0) return;

    const documentContent = commentsNodeEntry
      .map(([node]) => node.text)
      .join('');

    const { id } = await createDiscussionWithComment.mutateAsync({
      contentRich: commentValue as any,
      documentContent,
      documentId: documentId!,
    });

    commentsNodeEntry.forEach(([_, path]) => {
      editor.tf.setNodes(
        {
          [getCommentKey(id)]: true,
        },
        { at: path, split: true }
      );
      editor.tf.unsetNodes([getDraftCommentKey()], { at: path });
    });
  }, [
    discussionId,
    editor,
    createDiscussionWithComment,
    commentValue,
    documentId,
    createComment,
  ]);

  const onAddSuggestion = React.useCallback(async () => {
    if (!discussionId) return;

    const suggestionId = discussionId;

    await createDiscussionWithComment.mutateAsync({
      contentRich: commentValue as any,
      discussionId: suggestionId,
      documentContent: '__suggestion__',
      documentId: documentId!,
    });
  }, [discussionId, createDiscussionWithComment, commentValue, documentId]);

  return (
    <div className={cn('flex w-full', className)}>
      <div className="mt-1 shrink-0">
        {currentUser && (
          <Avatar className="mr-2 size-6">
            <AvatarImage alt={currentUser.name!} src={currentUser.image!} />
            <AvatarFallback>{currentUser.name?.[0]}</AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className="-ml-1 relative flex grow gap-2">
        <Plate
          editor={commentEditor}
          onChange={({ value }) => {
            setCommentValue(value);
          }}
        >
          <EditorContainer variant="comment">
            <Editor
              autoComplete="off"
              autoFocus={autoFocus}
              className="min-h-[25px] grow pt-0.5 pr-8"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();

                  if (isSuggesting) {
                    void onAddSuggestion();
                  } else {
                    void onAddComment();
                  }
                }
              }}
              placeholder="Reply..."
              variant="comment"
            />

            <Button
              className="absolute right-0 bottom-0 ml-auto shrink-0"
              disabled={commentContent.trim().length === 0}
              onClick={(e) => {
                e.stopPropagation();

                if (isSuggesting) {
                  void onAddSuggestion();
                } else {
                  void onAddComment();
                }
              }}
              size="iconSm"
              variant="ghost"
            >
              <div className="flex size-6 items-center justify-center rounded-full bg-brand">
                <Icons.arrowUp className="size-4 stroke-[3px] text-background" />
              </div>
            </Button>
          </EditorContainer>
        </Plate>
      </div>
    </div>
  );
}
