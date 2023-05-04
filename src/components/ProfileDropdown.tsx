import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeftOnRectangleIcon,
  ChevronDownIcon,
  Cog8ToothIcon,
  ComputerDesktopIcon,
  MoonIcon,
  PaintBrushIcon,
  Squares2X2Icon,
  SunIcon,
} from "@heroicons/react/24/outline";
import configuration from "~/configuration";
import type UserSession from "~/core/session/types/user-session";
import {
  DARK_THEME_CLASSNAME,
  LIGHT_THEME_CLASSNAME,
  SYSTEM_THEME_CLASSNAME,
  setTheme,
} from "~/core/theming";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/core/ui/Dropdown";
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
      <DropdownMenuTrigger className="flex cursor-pointer items-center space-x-2 focus:outline-none">
        <ProfileAvatar user={userSession} />
        <ChevronDownIcon className="hidden h-3 sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="!min-w-[15rem]"
        collisionPadding={{ right: 20 }}
      >
        <DropdownMenuItem className="!h-10 rounded-none" clickable={false}>
          <div className="flex flex-col justify-start truncate text-left text-xs">
            <div className="text-gray-500">Signed in as</div>

            <div>
              <span className="block truncate">{signedInAsLabel}</span>
            </div>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem>
          <Link
            className="flex h-full w-full items-center space-x-2"
            href={configuration.paths.appHome}
          >
            <Squares2X2Icon className="h-5" />
            <span>Dashboard</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem>
          <Link
            className="full flex w-full items-center space-x-2"
            href="/settings/profile"
          >
            <Cog8ToothIcon className="h-5" />
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
            <ArrowLeftOnRectangleIcon className="h-5" />

            <span>Sign out</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

function ThemeSelectorSubMenu() {
  const Wrapper: React.FCC = ({ children }) => (
    <span className="flex items-center space-x-2.5">{children}</span>
  );

  return (
    <>
      <DropdownMenuSeparator className="hidden lg:flex" />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="hidden lg:flex">
          <Wrapper>
            <PaintBrushIcon className="h-5" />

            <span>Theme</span>
          </Wrapper>
        </DropdownMenuSubTrigger>

        <DropdownMenuSubContent>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setTheme(LIGHT_THEME_CLASSNAME)}
          >
            <Wrapper>
              <SunIcon className="h-4" />

              <span>Light</span>
            </Wrapper>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setTheme(DARK_THEME_CLASSNAME)}
          >
            <Wrapper>
              <MoonIcon className="h-4" />

              <span>Dark</span>
            </Wrapper>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setTheme(SYSTEM_THEME_CLASSNAME)}
          >
            <Wrapper>
              <ComputerDesktopIcon className="h-4" />

              <span>System</span>
            </Wrapper>
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

export default ProfileDropdown;
