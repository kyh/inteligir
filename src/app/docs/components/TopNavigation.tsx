import useSignOut from "~/core/hooks/use-sign-out";
import UserSession from "~/core/session/types/user-session";
import If from "~/components/If";
import { NavLink } from "~/components/NavLink";
import ProfileDropdown from "~/components/ProfileDropdown";

type TopNavigationProps = {
  userSession: Maybe<UserSession>;
};

export const TopNavigation = ({ userSession }: TopNavigationProps) => {
  const signOut = useSignOut();

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between gap-12 bg-zinc-900/20 px-4 backdrop-blur-sm transition dark:backdrop-blur sm:px-6 lg:left-72 lg:z-30 lg:px-8">
      <nav>
        <ul className="flex gap-3 md:gap-8">
          <li>
            <NavLink href="/">Home</NavLink>
          </li>
          <li>
            <NavLink href="/docs">Documentation</NavLink>
          </li>
          <li>
            <NavLink href="/pricing">Pricing</NavLink>
          </li>
        </ul>
      </nav>
      <If
        condition={userSession?.auth}
        fallback={
          <div className="space-x-2">
            <NavLink variant="primary" href="/auth/sign-in">
              Sign In
            </NavLink>
          </div>
        }
      >
        <ProfileDropdown userSession={userSession} signOutRequested={signOut} />
      </If>
    </header>
  );
};
