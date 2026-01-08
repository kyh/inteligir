/* eslint-disable react-hooks/refs */
'use client';

import { type YjsConfig as BaseYjsConfig, BaseYjsPlugin } from '@platejs/yjs';
import { YjsPlugin } from '@platejs/yjs/react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { type ExtendConfig, KEYS, NodeIdPlugin, type Value } from 'platejs';
import {
  createPlateEditor,
  Plate,
  toTPlatePlugin,
  usePlateEditor,
} from 'platejs/react';
import React, { useEffect, useMemo, useRef } from 'react';
import { useSession } from '@/components/auth/useSession';
import { EditorKit } from '@/components/editor/editor-kit-app';
import { env } from '@/env';
import { useDebouncedCallback } from '@/hooks/useDebounceCallback';
import { useInitialLocalStorage } from '@/hooks/useLocalStorage';
import { useWarnIfUnsavedChanges } from '@/hooks/useWarnIfUnsavedChanges';
import { BaseEditorKit } from '@/registry/components/editor/editor-base-kit';
import { useMounted } from '@/registry/hooks/use-mounted';
import { RemoteCursorOverlay } from '@/registry/ui/remote-cursor-overlay';
import type { AuthUser } from '@/server/auth/getAuthUser';
import { useUpdateDocumentValue } from '@/trpc/hooks/document-hooks';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';
import {
  getTemplateDocument,
  type TemplateDocument,
  useTemplateDocument,
} from './utils/useTemplateDocument';

export function DocumentPlate({ children }) {
  const updateDocumentValue = useUpdateDocumentValue();
  const session = useSession();
  const user = session?.user ?? null;

  const queryOptions = useDocumentQueryOptions();
  const { data: documentId } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.id,
  });
  const { data: lockPage } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.lockPage,
  });
  const { data: isArchived } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.isArchived,
  });
  const { data: templateId } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.templateId,
  });
  const { data: contentRich } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.contentRich,
  });

  const { data: isPublished } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.isPublished,
  });

  // Generate a consistent color for the user based on their username

  const value =
    templateId && !contentRich
      ? getTemplateDocument(templateId)?.value
      : (contentRich as Value);

  const isYjsEnabled = Boolean(
    documentId && isPublished && env.NEXT_PUBLIC_YJS_URL
  );

  // Track previous Yjs state and last known Yjs editor value
  const prevIsYjsEnabledRef = useRef(isYjsEnabled);
  const lastYjsValueRef = useRef<Value | null>(null);

  // When transitioning from Yjs enabled to disabled, use the last Yjs value
  // instead of the stale cache value
  const isTransitioningFromYjs = prevIsYjsEnabledRef.current && !isYjsEnabled;
  const valueToUse =
    isTransitioningFromYjs && lastYjsValueRef.current
      ? lastYjsValueRef.current
      : value;

  // Save editor content to cache when transitioning from Yjs enabled to disabled
  if (isTransitioningFromYjs && lastYjsValueRef.current && documentId) {
    updateDocumentValue({ id: documentId, value: lastYjsValueRef.current });
  }

  prevIsYjsEnabledRef.current = isYjsEnabled;

  const { cursorColor, roomName, username } = useYjs({
    documentId,
    user,
  });

  const editor = usePlateEditor(
    {
      id: documentId,
      plugins: [
        ...EditorKit,
        yjsPlugin.configure({
          enabled: isYjsEnabled,
          options: {
            cursors: {
              data: { color: cursorColor, name: username },
            },
            providers: [
              {
                options: {
                  name: documentId!,
                  url: env.NEXT_PUBLIC_YJS_URL,
                },
                type: 'hocuspocus' as const,
              },
            ],
          },
          render: {
            afterEditable: RemoteCursorOverlay,
          },
        }),
        NodeIdPlugin.configure({
          priority: 50,
        }),
      ],
      skipInitialization: !!isYjsEnabled,
      value: isYjsEnabled ? undefined : valueToUse,
      userId: user?.id,
    },
    [documentId, isYjsEnabled, isTransitioningFromYjs]
  );

  const mounted = useMounted();

  useEffect(() => {
    if (!mounted || !isYjsEnabled) {
      return;
    }

    editor.setOption(yjsPlugin, 'isReady', false);

    void editor.getApi(YjsPlugin).yjs?.init({
      id: roomName,
      autoSelect: 'end',
      value,
      onReady: () => {
        editor.setOption(yjsPlugin, 'isReady', true);
      },
    });

    return () => {
      editor.getApi(YjsPlugin).yjs?.destroy();
      editor.setOption(yjsPlugin, 'isReady', false);
    };
  }, [editor, isYjsEnabled, mounted, roomName, value]);

  return (
    <Plate
      editor={editor}
      onValueChange={({ editor, value }) => {
        if (isYjsEnabled) {
          // Store the latest Yjs value so we can save it when disabling Yjs
          lastYjsValueRef.current = value;
        } else {
          updateDocumentValue({ id: editor.id, value });
        }
      }}
      readOnly={lockPage || isArchived}
    >
      {children}
    </Plate>
  );
}

export function PublicPlate({ children }: React.PropsWithChildren) {
  const templateDocument = useTemplateDocument();
  const [template, setTemplate] = useInitialLocalStorage<
    TemplateDocument | undefined
  >(`potion-2-${templateDocument?.id ?? 'ai'}`, templateDocument);
  const value = template?.value;
  const id = template?.id;
  const editor = usePlateEditor({
    id,
    override: {
      enabled: {
        [KEYS.copilot]: id === 'copilot',
      },
    },
    plugins: EditorKit,
    value,
  });

  const onDebouncedDocumentChange = useDebouncedCallback(
    (id: string, v: Value) => {
      setTemplate({
        id,
        icon: null,
        title: template?.title ?? '',
        value: v,
      });
    },
    1000
  );

  useWarnIfUnsavedChanges({ enabled: onDebouncedDocumentChange.isPending() });

  return (
    <Plate
      editor={editor}
      onValueChange={({ editor, value }) => {
        if (editor.meta.resetting) {
          editor.meta.resetting = undefined;

          return;
        }

        onDebouncedDocumentChange(editor.id, value);
      }}
    >
      {children}
    </Plate>
  );
}

export function PrintPlate({ children }: React.PropsWithChildren) {
  const searchParams = useSearchParams();
  const disableMedia = searchParams.get('disableMedia') === 'true';

  const queryOptions = useDocumentQueryOptions();

  const { data: templateId } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.templateId,
  });

  const { data: contentRich } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.contentRich,
  });

  const value =
    templateId && !contentRich
      ? getTemplateDocument(templateId).value
      : (contentRich as Value);

  const editor = useMemo(() => {
    const e = createPlateEditor({
      override: {
        enabled: {
          [KEYS.audio]: !disableMedia,
          [KEYS.file]: !disableMedia,
          [KEYS.img]: !disableMedia,
          [KEYS.mediaEmbed]: !disableMedia,
          [KEYS.video]: !disableMedia,
        },
      },
      plugins: BaseEditorKit,
      value,
    });
    e.meta.mode = 'print';
    return e;
  }, [value, disableMedia]);

  return (
    <Plate editor={editor} readOnly>
      {children}
    </Plate>
  );
}

function useYjs({
  documentId,
  user,
}: {
  user: AuthUser | null;
  documentId?: string;
}): { cursorColor: string; roomName: string | undefined; username: string } {
  const roomName = documentId;

  const cursorColor = React.useMemo(() => {
    if (!user?.username) return '#888888';

    let hash = 0;

    for (let i = 0; i < user.username.length; i++) {
      const codePoint = user.username?.codePointAt(i) ?? 0;
      hash = codePoint + ((hash << 5) - hash);
    }

    const hue = hash % 360;

    return `hsl(${hue}, 70%, 60%)`;
  }, [user?.username]);

  return {
    cursorColor,
    roomName,
    username: user?.username || 'Anonymous',
  };
}

type YjsConfig = ExtendConfig<
  BaseYjsConfig,
  {
    isReady: boolean;
  }
>;

export const yjsPlugin = toTPlatePlugin<YjsConfig>(BaseYjsPlugin, {
  options: {
    isReady: false,
  },
});
