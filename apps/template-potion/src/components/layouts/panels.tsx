'use client';

import React from 'react';

import type { RightPanelType } from '@/hooks/useResizablePanel';

import { useSearchParams } from 'next/navigation';

import { useIsDesktop } from '@/components/providers/tailwind-provider';
import { useCookieStorage } from '@/hooks/useCookieStorage';
import { useDocumentId } from '@/lib/navigation/routes';
import { useMounted } from '@/registry/hooks/use-mounted';

import { ContextPanel } from '../context-panel/context-panel';
import { Navbar } from '../navbar/navbar';
import { Sidebar } from '../sidebar/sidebar';
import {
  type Layout,
  ResizableLeftPanel,
  ResizableMidPanel,
  ResizablePanelGroup,
  ResizableRightPanel,
} from '../ui/resizable-panel';

const serverPersistenceId = 'nav';
const serverPersistenceRightPanelType = 'right-panel-type';

interface PanelsProps {
  children: React.ReactNode;
  initialLayout: Layout;
  initialRightPanelType: RightPanelType;
}

export const Panels = ({
  children,
  initialLayout,
  initialRightPanelType,
}: PanelsProps) => {
  const documentId = useDocumentId();
  const searchParams = useSearchParams();

  const hiddenSidebar = searchParams.get('hidden-sidebar') === 'true';

  const isMobile = !useIsDesktop();
  const mounted = useMounted();

  const [layout, setLayoutCookieValue] = useCookieStorage<Layout>(
    serverPersistenceId,
    initialLayout
  );

  const [, setRightPanelTypeCookieValue] = useCookieStorage<RightPanelType>(
    serverPersistenceRightPanelType,
    initialRightPanelType
  );

  return (
    <ResizablePanelGroup
      className="min-h-[200px] rounded-lg"
      onLayout={setLayoutCookieValue}
      onRightPanelTypeChange={setRightPanelTypeCookieValue}
      hiddenLeft={isMobile}
      initLeftSize={layout.leftSize!}
      initRightSize={layout.rightSize!}
      serverPersistenceId={serverPersistenceId}
      serverPersistenceRightPanelType={serverPersistenceRightPanelType}
      hiddenRight
    >
      {!hiddenSidebar && (
        <ResizableLeftPanel maxSize={500} minSize={250}>
          <Sidebar />
        </ResizableLeftPanel>
      )}

      <ResizableMidPanel className="relative flex flex-col">
        <Navbar />
        {children}
      </ResizableMidPanel>

      {mounted && documentId && (
        <ResizableRightPanel maxSize={700} minSize={380}>
          <ContextPanel />
        </ResizableRightPanel>
      )}
    </ResizablePanelGroup>
  );
};
