"use client";

import { useMemo } from "react";
import Trans from "@inteligir/ui/trans";
import Link from "next/link";
import {
  ChevronDownIcon,
  ArrowLeftOnRectangleIcon,
  Squares2X2Icon,
  BuildingLibraryIcon,
} from "@heroicons/react/24/outline";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@inteligir/ui";
import ProfileAvatar from "@/components/profile-avatar";
import { If } from "@/components/if";
import configuration from "@/configuration";
import type UserSession from "@/lib/session/types/user-session";
import GlobalRole from "@/lib/session/types/global-role";
import useUser from "@/lib/hooks/use-user";

const ProfileDropdown: React.FCC<{
  userSession: Maybe<UserSession>;
  signOutRequested: () => unknown;
}> = ({ userSession, signOutRequested }) => {
  const { data: user } = useUser();

  const signedInAsLabel = useMemo(() => {
    const displayName = userSession?.data?.displayName || undefined;
    const email = userSession?.auth?.user.email || undefined;
    const phone = userSession?.auth?.user.phone || undefined;

    return displayName ?? email ?? phone;
  }, [userSession]);

  const isSuperAdmin = useMemo(() => {
    return user?.app_metadata.role === GlobalRole.SuperAdmin;
  }, [user]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex cursor-pointer items-center space-x-2 focus:outline-none">
        <ProfileAvatar user={userSession} />
        <ChevronDownIcon className="hidden h-3 sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="!min-w-[15rem]"
        collisionPadding={{ right: 20 }}
      >
        <DropdownMenuItem className="!h-10 rounded-none">
          <div className="flex flex-col justify-start truncate text-left text-xs">
            <div className="text-gray-500">Signed in as</div>

            <div>
              <span className="block truncate">{signedInAsLabel}</span>
            </div>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link
            className="flex h-full w-full items-center space-x-2"
            href={configuration.paths.appHome}
          >
            <Squares2X2Icon className="h-5" />
            <span>
              <Trans i18nKey="common:dashboardTabLabel" />
            </span>
          </Link>
        </DropdownMenuItem>

        <If condition={isSuperAdmin}>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              className="flex h-full w-full items-center space-x-2"
              href="/admin"
            >
              <BuildingLibraryIcon className="h-5" />
              <span>Admin</span>
            </Link>
          </DropdownMenuItem>
        </If>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="cursor-pointer"
          onClick={signOutRequested}
          role="button"
        >
          <span className="flex w-full items-center space-x-2">
            <ArrowLeftOnRectangleIcon className="h-5" />

            <span>
              <Trans i18nKey="auth:signOut" />
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProfileDropdown;
