'use client';

import { useSearchParams } from 'next/navigation';
import React from 'react';
import { useIsDesktop } from '@/components/providers/tailwind-provider';
import { useTParams } from '@/hooks/use-navigation';
import { useCookieStorage } from '@/hooks/useCookieStorage';
import type { RightPanelType } from '@/hooks/useResizablePanel';
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

type PanelsProps = {
  children: React.ReactNode;
  initialLayout: Layout;
  initialRightPanelType: RightPanelType;
};

export const Panels = ({
  children,
  initialLayout,
  initialRightPanelType,
}: PanelsProps) => {
  const { documentId } = useTParams<'/[documentId]'>();
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
      hiddenLeft={isMobile}
      hiddenRight
      initLeftSize={layout.leftSize!}
      initRightSize={layout.rightSize!}
      onLayout={setLayoutCookieValue}
      onRightPanelTypeChange={setRightPanelTypeCookieValue}
      serverPersistenceId={serverPersistenceId}
      serverPersistenceRightPanelType={serverPersistenceRightPanelType}
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
