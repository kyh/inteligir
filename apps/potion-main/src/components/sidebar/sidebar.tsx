import { HouseIcon } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import React from 'react';
import { toast } from 'sonner';

import { useSession } from '@/components/auth/useSession';
import { useIsDesktop } from '@/components/providers/tailwind-provider';
import { SearchStore } from '@/components/search/SearchStore';
import { useToggleLeftPanel } from '@/hooks/useResizablePanel';
import { cn } from '@/lib/utils';
import { useMounted } from '@/registry/hooks/use-mounted';
import { Button } from '@/registry/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/ui/popover';
import { api, useTRPC } from '@/trpc/react';

import { useAuthGuard } from '../auth/useAuthGuard';
import { pushModal } from '../modals';
import { Icons } from '../ui/icons';
import { DocumentList } from './document-list';
import { NavItem } from './nav-item';
import { SidebarSwitcher } from './sidebar-switcher';
import { TrashBox } from './trash-box';

export function Sidebar({ ...props }: React.HTMLAttributes<HTMLElement>) {
  const session = useSession();
  const router = useRouter();
  const isMobile = !useIsDesktop();
  const trpc = useTRPC();
  const createDocument = api.document.create.useMutation({
    onSuccess: () => {
      void trpc.document.documents.invalidate();
    },
  });
  const authGuard = useAuthGuard();
  const mounted = useMounted();

  const onCreate = () => {
    authGuard(() => {
      const promise = createDocument
        .mutateAsync({
          contentRich: [
            {
              children: [{ text: '' }],
              type: 'p',
            },
          ],
        })
        .then((document) => {
          router.push(`/${document.id}` as Route);
        });

      toast.promise(promise, {
        error: 'Failed to create a new note!',
        loading: 'Creating a new note...',
        success: 'New Note created.',
      });
    });
  };

  return (
    <aside
      className={cn(
        'group/sidebar relative z-20 flex size-full flex-col overflow-y-auto border-r',
        props.className
      )}
      {...props}
    >
      <SidebarSwitcher />

      <div className="absolute top-2 right-2 z-50 flex gap-0.5">
        <CloseButton />

        <Button
          className="size-[28px]"
          onClick={onCreate}
          size="navAction"
          tooltip="Create a new page"
          tooltipContentProps={{
            side: 'right',
          }}
          variant="nav"
        >
          <Icons.newPage variant="primary" />
        </Button>
      </div>

      <div className="space-y-6 px-2">
        <div className="space-y-0.5">
          <NavItem
            icon={Icons.search}
            label="Search"
            onClick={() => {
              SearchStore.actions.onOpen();
            }}
            tooltip="Search page"
          />
          <NavItem
            href="/"
            icon={HouseIcon}
            label="Home"
            tooltip="View recent pages"
          />
        </div>

        <div className="space-y-0.5">
          <NavItem
            className="text-muted-foreground/90 text-xs"
            label={session ? 'Private' : 'Draft'}
            onClick={() => {}}
          >
            <Button
              onClick={onCreate}
              size="navAction"
              tooltip="Create a new page"
              tooltipContentProps={{
                side: 'right',
              }}
              variant="navAction"
            >
              <Icons.plus variant="muted" />
            </Button>
          </NavItem>

          <DocumentList />
        </div>

        <div className="space-y-0.5">
          <NavItem
            icon={Icons.settings}
            label="Settings"
            onClick={() => {
              authGuard(() => {
                pushModal('Settings');
              });
            }}
            tooltip="Manage your account and settings"
          />

          <NavItem href="/editor" icon={Icons.editor} label="Editor" />

          <NavItem
            href="https://pro.platejs.org/docs/templates/potion"
            icon={Icons.templates}
            label="Templates"
          />

          {mounted ? (
            <Popover>
              <PopoverTrigger
                asChild
                className="w-full"
                onClick={(e) => {
                  if (authGuard()) {
                    e.preventDefault();
                  }
                }}
              >
                <NavItem
                  icon={Icons.trash}
                  label="Trash"
                  tooltip="Restore deleted pages"
                />
              </PopoverTrigger>

              <PopoverContent
                align="start"
                className="h-[50vh] max-h-[70vh] w-80 p-0"
                side={isMobile ? 'bottom' : 'right'}
              >
                <TrashBox />
              </PopoverContent>
            </Popover>
          ) : (
            <NavItem loading />
          )}
        </div>
      </div>
    </aside>
  );
}

const CloseButton = () => {
  const toggle = useToggleLeftPanel();

  return (
    <Button
      className="group/button size-[28px] opacity-100"
      onClick={() => toggle()}
      size="navAction"
      tooltip="Close sidebar"
      tooltipContentProps={{
        side: 'right',
      }}
      variant="nav"
    >
      <Icons.chevronsLeft
        className="size-5 transition-opacity duration-300 group-hover/button:text-muted-foreground group-hover/sidebar:opacity-100 md:opacity-0"
        variant="muted"
      />
    </Button>
  );
};
