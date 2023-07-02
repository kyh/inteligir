import { useMemo } from "react";
import Link from "next/link";
import { CogIcon, LayoutDashboardIcon, LogOutIcon } from "lucide-react";
import type UserSession from "~/core/session/types/user-session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/Dropdown";
import ProfileAvatar from "~/components/ProfileAvatar";

const ProfileDropdown: React.FCC<{
  userSession: Maybe<UserSession>;
  signOutRequested: () => unknown;
}> = ({ userSession, signOutRequested }) => {
  const signedInAsLabel = useMemo(() => {
    const displayName = userSession?.data?.displayName || undefined;
    const email = userSession?.auth?.user.email || undefined;
    const phone = userSession?.auth?.user.phone || undefined;

    return displayName ?? email ?? phone;
  }, [userSession]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative h-8 w-8 rounded-full">
          <ProfileAvatar user={userSession} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56"
        align="end"
        forceMount
        collisionPadding={{ right: 20 }}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-2">
            <p className="text-sm font-medium leading-none">Signed in as</p>
            <p className="text-xs leading-none text-muted-foreground">
              {signedInAsLabel}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Link
            className="flex h-full w-full items-center space-x-2"
            href="/dashboard"
          >
            <LayoutDashboardIcon className="h-5" />
            <span>Dashboard</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Link
            className="flex w-full items-center space-x-2"
            href="/settings/profile"
          >
            <CogIcon className="h-5" />
            <span>Settings</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          role="button"
          className="cursor-pointer"
          onClick={signOutRequested}
        >
          <span className="flex w-full items-center space-x-2">
            <LogOutIcon className="h-5" />
            <span>Sign out</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProfileDropdown;
