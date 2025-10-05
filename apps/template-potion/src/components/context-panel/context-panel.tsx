import { useMemo } from 'react';

import dynamic from 'next/dynamic';

import DiscussionRightPanel from '@/components/context-panel/discussion-panel';
import { VersionsSkeleton } from '@/components/context-panel/versions-skeleton';
import {
  RightPanelType,
  useRightPanelSize,
  useRightPanelType,
} from '@/hooks/useResizablePanel';
import { useDocumentId } from '@/lib/navigation/routes';

const VersionHistoryPanel = dynamic(
  () => import('@/components/editor/version-history/version-history-panel'),
  {
    loading: () => <p>Loading...</p>,
  }
);

export const ContextPanel = () => {
  const rightSize = useRightPanelSize();
  const rightType = useRightPanelType();
  const documentId = useDocumentId();

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
