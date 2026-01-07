import { useQuery } from '@tanstack/react-query';
import { formatDistance } from 'date-fns';
import { createAtomStore } from 'jotai-x';
import { cloneDeep } from 'lodash';
import type { Value } from 'platejs';
import { useEditorRef } from 'platejs/react';
import React, { memo, useEffect, useState } from 'react';

import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { useDebouncedValueVersion } from '@/components/editor/utils';
import { DiffPlate } from '@/components/editor/version-history/diff-plate';
import { pushModal } from '@/components/modals';
import { Empty } from '@/components/ui/empty';
import { Icons } from '@/components/ui/icons';
import { useLayoutParams } from '@/hooks/use-navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/registry/ui/avatar';
import { Button } from '@/registry/ui/button';
import {
  useDocumentQueryOptions,
  useDocumentVersionsQueryOptions,
} from '@/trpc/hooks/query-options';
import { api, useTRPC } from '@/trpc/react';

import { VersionsSkeleton } from '../../context-panel/versions-skeleton';

export const {
  useVersionSet,
  useVersionState,
  useVersionValue,
  VersionProvider,
} = createAtomStore(
  {
    activeVersionId: null as number | string | null,
  },
  {
    name: 'version',
  }
);

export default memo(function VersionHistoryPanel() {
  const { documentId } = useLayoutParams<'/[documentId]'>();
  const currentUser = useCurrentUser();

  // Stable timestamp for relative time calculations - initialized once on mount
  const [now] = useState(() => Date.now());

  const trpc = useTRPC();
  const queryOptions = useDocumentQueryOptions();
  const found = useQuery({
    ...queryOptions,
    select: (data) => !!data.document,
  });
  const versions = useQuery(useDocumentVersionsQueryOptions());
  const createVersion = api.version.createVersion.useMutation({
    onSuccess: () => {
      void trpc.version.documentVersions.invalidate({ documentId });
    },
  });
  const deleteVersion = api.version.deleteVersion.useMutation({
    onSuccess: () => {
      void trpc.version.documentVersions.invalidate({ documentId });
    },
  });

  const onDeleteVersionDialog = React.useCallback(
    (id: string) => {
      pushModal('Confirm', {
        name: 'version',
        onConfirm: () => {
          deleteVersion.mutate({ id });
        },
      });
    },
    [deleteVersion]
  );

  return (
    // <div className="mt-[44px] flex h-[calc(100vh-44px)] flex-col">
    <div className="flex h-[calc(100vh)] flex-col">
      <div className="flex shrink-0 items-center justify-between border-b">
        <div className="px-4 py-3 font-semibold text-sm text-subtle-foreground">
          Version history
        </div>

        <div className="px-4 py-3">
          <Button
            disabled={createVersion.isPending}
            onClick={() => {
              if (!found.data) return;

              createVersion.mutate({ documentId });
            }}
            variant="brand"
          >
            Save version
          </Button>
        </div>
      </div>

      <div className="grow overflow-y-auto text-sm">
        {documentId && versions.data && versions.data.versions.length > 0 ? (
          versions.data.versions.map(
            (version, index) =>
              version && (
                <div className="flex border-b px-4 pt-3" key={index}>
                  <Avatar className="mr-2 size-7">
                    <AvatarImage alt={version.username} src={version.image!} />
                    <AvatarFallback>{version.username}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <div>
                        {currentUser?.id === version.userId
                          ? 'You'
                          : version.username}
                        &nbsp;saved{' '}
                        <span className="font-semibold">{document.title}</span>
                      </div>

                      <div className="shrink-0">
                        <Button
                          className="mr-2 size-6 p-1"
                          onClick={() => {
                            pushModal('VersionHistory', {
                              activeVersionId: version.id,
                            });
                          }}
                          tooltip="View version for this update"
                          variant="ghost"
                        >
                          <Icons.clock />
                        </Button>

                        <Button
                          className="group size-6 p-1 hover:bg-destructive"
                          onClick={() => onDeleteVersionDialog(version.id)}
                          variant="ghost"
                        >
                          <Icons.trash className="group-hover:text-destructive-foreground" />
                        </Button>
                      </div>
                    </div>

                    <div className="text-muted-foreground/80 text-xs">
                      {formatDistance(version.createdAt, now, {
                        addSuffix: true,
                      })}
                    </div>

                    <div>
                      {index === 0 ? (
                        <CurrentDiffPlate
                          previous={version.contentRich as Value}
                        />
                      ) : (
                        <DiffPlate
                          current={
                            versions.data?.versions[index - 1]
                              ?.contentRich as Value
                          }
                          previous={version.contentRich as Value}
                          showDiff
                        />
                      )}
                    </div>
                  </div>
                </div>
              )
          )
        ) : versions.data ? (
          <Empty title="No saved versions." />
        ) : (
          <VersionsSkeleton />
        )}
      </div>
    </div>
  );
});

export function CurrentDiffPlate({ previous }: { previous: Value | null }) {
  const editor = useEditorRef();
  const [current, setCurrent] = useState(cloneDeep(editor.children));
  const version = useDebouncedValueVersion(1000);

  useEffect(() => {
    if (version) {
      setCurrent(cloneDeep(editor.children));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return <DiffPlate current={current} previous={previous} showDiff />;
}
