'use client';

import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { useLogoutMutation } from '@/components/auth/useLogoutMutation';
import { Avatar, AvatarImage } from '@/registry/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/ui/dropdown-menu';
import { Spinner } from '@/registry/ui/spinner';

import { useAuthGuard } from '../auth/useAuthGuard';
import { pushModal } from '../modals';
import { Icons } from '../ui/icons';
import { Skeleton } from '../ui/skeleton';

export function SidebarSwitcher() {
  const user = useCurrentUser();
  const logout = useLogoutMutation();
  const authGuard = useAuthGuard();

  if (!user.id) {
    return (
      <div
        className="group mx-2 my-1.5 flex min-h-[32px] cursor-pointer items-center gap-2 border-b border-sidebar-border/50 px-2 py-1 pr-0.5 text-sm font-semibold text-sidebar-text transition-colors duration-200 hover:bg-sidebar-hover"
        onClick={() => {
          authGuard(() => pushModal('Login'));
        }}
        role="button"
      >
        <div className="px-0.5">
          {user.isLoading ? (
            <Skeleton className="size-5 rounded-sm" />
          ) : (
            <Icons.user className="size-5 text-sidebar-text-muted" />
          )}
        </div>
        {user.isLoading ? <Skeleton className="h-4 w-3/5" /> : 'Sign in'}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div
          className="group mx-2 my-1.5 flex min-h-[32px] cursor-pointer items-center gap-2 border-b border-sidebar-border/50 px-2 py-1 pr-0.5 text-sm font-semibold text-sidebar-text transition-colors duration-200 hover:bg-sidebar-hover"
          onClick={() => {
            pushModal('Login');
          }}
          role="button"
        >
          <Avatar className="size-5">
            <AvatarImage alt={user.firstName ?? ''} src={user.image ?? ''} />
          </Avatar>

          <span className="line-clamp-1 select-none text-start">
            {user.firstName}&apos;s Potion
          </span>
          <Icons.chevronDown className="size-3 text-sidebar-text-muted" />
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" alignOffset={11} className="w-fit">
        <div className="flex space-x-2 p-3">
          <Avatar className="size-9">
            <AvatarImage alt={user.firstName!} src={user.image!} />
          </Avatar>

          <div className="flex flex-col items-start justify-center space-y-1 text-start">
            <p className="line-clamp-1 font-medium text-sm">{user.firstName}</p>
            <p className="font-medium text-muted-foreground text-xs leading-none">
              {user.email}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="mx-1 my-1.5 font-medium text-muted-foreground text-xs"
          onClick={(e) => {
            e.preventDefault();

            logout.mutate();
          }}
        >
          {logout.isPending ? <Spinner /> : <Icons.logout />}
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
