"use client";

import { ArrowRightIcon } from "@heroicons/react/24/outline";

import { Logo } from "~/components/Logo";
import Container from "~/core/ui/Container";
import If from "~/core/ui/If";
import Button from "~/core/ui/Button";
import SiteNavigation from "./SiteNavigation";
import useSignOut from "~/core/hooks/use-sign-out";
import useUserSession from "~/core/hooks/use-user-session";

import ProfileDropdown from "~/components/ProfileDropdown";

import configuration from "~/configuration";

const fixedClassName = `FixedHeader`;

const SiteHeader: React.FCC<{
  fixed?: boolean;
}> = ({ fixed }) => {
  const signOut = useSignOut();
  const userSession = useUserSession();

  return (
    <div className={`w-full py-4 ${fixed ? fixedClassName : ""}`}>
      <Container>
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center space-x-4 lg:space-x-8">
            <Logo />

            <SiteNavigation />
          </div>

          <div className="flex flex-1 items-center justify-end space-x-4">
            <If condition={userSession?.auth} fallback={<AuthButtons />}>
              <ProfileDropdown
                userSession={userSession}
                signOutRequested={signOut}
              />
            </If>
          </div>
        </div>
      </Container>
    </div>
  );
};

function AuthButtons() {
  return (
    <div className="hidden space-x-2 lg:flex">
      <Button round color="transparent" href={configuration.paths.signIn}>
        <span>Sign In</span>
      </Button>

      <Button round color="secondary" href={configuration.paths.signUp}>
        <span className="flex items-center space-x-2">
          <span>Sign Up</span>
          <ArrowRightIcon className="h-4" />
        </span>
      </Button>
    </div>
  );
}

export default SiteHeader;
