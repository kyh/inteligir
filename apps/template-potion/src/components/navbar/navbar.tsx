'use client';

import React, { useContext } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useTemplateDocument } from '@/components/editor/utils/useTemplateDocument';
import {
  DocumentMenu,
  DocumentMenuSkeleton,
} from '@/components/navbar/document-menu';
import { DocumentShare } from '@/components/navbar/document-share';
import { NavTitle, NavTitleSkeleton } from '@/components/navbar/nav-title';
import { Icons } from '@/components/ui/icons';
import {
  RightPanelType,
  useLeftPanelSize,
  useToggleLeftPanel,
  useToggleRightPanel,
} from '@/hooks/useResizablePanel';
import { Button } from '@/registry/ui/button';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

import { useAuthGuard } from '../auth/useAuthGuard';
import { PanelsContext } from '../ui/resizable-panel';
import { DocumentSuggesting } from './document-suggesting';

const DocumentHistory = () => {
  const toggleRight = useToggleRightPanel();
  const authGuard = useAuthGuard();
  const { rightPanelType, rightSize = 0 } = useContext(PanelsContext);

  return (
    <Button
      size="icon"
      variant={
        rightSize > 0 && rightPanelType === RightPanelType.history
          ? 'ghostActive'
          : 'ghost'
      }
      onClick={() => authGuard(() => toggleRight(RightPanelType.history, 400))}
      tooltip="View all versions"
    >
      <Icons.history />
    </Button>
  );
};

const DocumentComment = () => {
  const toggleRight = useToggleRightPanel();
  const authGuard = useAuthGuard();
  const { rightPanelType, rightSize = 0 } = useContext(PanelsContext);

  return (
    <Button
      size="icon"
      variant={
        rightSize > 0 && rightPanelType === RightPanelType.comment
          ? 'ghostActive'
          : 'ghost'
      }
      onClick={() => {
        authGuard(() => toggleRight(RightPanelType.comment, 400));
      }}
      tooltip="View all comments"
    >
      <Icons.comment />
    </Button>
  );
};

export const HomeNavBar = () => {
  const isCollapsed = useLeftPanelSize() === 0;
  const toggle = useToggleLeftPanel();

  return (
    <nav className="size-full bg-transparent px-3 py-2">
      {isCollapsed && (
        <Button size="icon" variant="ghost" onClick={() => toggle(350)}>
          <Icons.menu />
        </Button>
      )}
    </nav>
  );
};

export const Navbar = () => {
  const isCollapsed = useLeftPanelSize() === 0;
  const toggle = useToggleLeftPanel();
  const { data: id, isLoading } = useQuery({
    ...useDocumentQueryOptions(),
    select: (data) => data.document?.id,
  });
  const template = useTemplateDocument();
  const found = !!template || !!id;
  const shouldRedirect = !!template && !!id;

  return (
    <nav className="relative z-10 flex h-[44px] items-center gap-x-4 bg-background px-1 py-2 sm:px-3 dark:bg-[#1f1f1f]">
      {isCollapsed && (
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          onClick={() => toggle(250)}
        >
          <Icons.menu />
        </Button>
      )}

      {id && (isLoading || shouldRedirect) ? (
        <>
          <NavTitleSkeleton />
          <div className="flex items-center gap-x-2">
            <DocumentMenuSkeleton />
          </div>
        </>
      ) : (
        found && (
          <>
            <div className="flex grow items-center justify-between">
              <NavTitle />
              <div className="flex shrink-0 items-center gap-x-0.5">
                <DocumentSuggesting />
                <DocumentShare />
                <DocumentComment />
                <DocumentHistory />
                <DocumentMenu />
              </div>
            </div>
          </>
        )
      )}
    </nav>
  );
};
