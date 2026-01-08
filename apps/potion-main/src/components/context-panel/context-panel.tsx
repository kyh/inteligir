import dynamic from 'next/dynamic';
import { useMemo } from 'react';

import DiscussionRightPanel from '@/components/context-panel/discussion-panel';
import { VersionsSkeleton } from '@/components/context-panel/versions-skeleton';
import { useTParams } from '@/hooks/use-navigation';
import {
  RightPanelType,
  useRightPanelSize,
  useRightPanelType,
} from '@/hooks/useResizablePanel';

const VersionHistoryPanel = dynamic(
  () => import('@/components/editor/version-history/version-history-panel'),
  {}
);

export const ContextPanel = () => {
  const rightSize = useRightPanelSize();
  const rightType = useRightPanelType();
  const { documentId } = useTParams<'/[documentId]'>();

  const isOpen = useMemo(() => !!rightSize && rightSize > 0, [rightSize]);

  return (
    <>
      {rightType === RightPanelType.history && isOpen && (
        <VersionHistoryPanel />
      )}

      {rightType === RightPanelType.comment &&
        isOpen &&
        (documentId ? <DiscussionRightPanel /> : <VersionsSkeleton />)}
    </>
  );
};
